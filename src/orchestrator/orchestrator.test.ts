import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db } from '@/db/client';
import { applications, applicationStates } from '@/db/schema';
import { closeDb, resetDb } from '@/db/test-helpers';
import { intakeService } from '@/services/intake';
import {
  __resetForTesting as resetRegistroCivil,
  setMode as setRegistroCivilMode,
} from '@/services/mocks/registro-civil';
import {
  __resetForTesting as resetIess,
} from '@/services/mocks/iess';
import {
  __resetForTesting as resetEquifax,
  getEquifaxClient,
} from '@/services/mocks/equifax';
import {
  __resetForTesting as resetAltScore,
  setMode as setAltScoreMode,
} from '@/services/mocks/score-alternativo';
import { altScoreAgent } from '@/agents/alt_score';
import { HARD_INQUIRY_PENALTY } from '@/services/mocks/equifax/config';
import { personas, cedulasNotFound } from '@/services/mocks/_dataset/personas';
import { RecordingTracer } from '@/lib/tracer';
import { runOrchestrator, defaultPipeline } from './index';
import { OperationalError, DomainError } from '@/lib/errors';
import { identityAgent } from '@/agents/identity';
import { incomeAgent } from '@/agents/income';
import { bureauAgent } from '@/agents/bureau';
import { failingTestAgent } from '@/test-utils/failing-agent';

beforeEach(async () => {
  await resetDb();
  resetRegistroCivil();
  resetIess();
  resetEquifax();
  resetAltScore();
});

afterAll(closeDb);

describe('runOrchestrator — happy path identity → income → [bureau ‖ alt_score] → policy', () => {
  it('produces v0..v5 with policy at v5 (mocked LLM returns MIC-003)', async () => {
    const tracer = new RecordingTracer();
    const target = personas.find(
      (p) => p.employment !== undefined && p.altScore !== undefined,
    )!;

    const intake = await intakeService.execute(
      {
        cedula: target.cedula,
        ingresos: 1500,
        monto: 3000,
        plazo: 24,
      },
      { tracer },
    );

    await runOrchestrator(intake.applicationId, { tracer }, defaultPipeline);

    const states = await db.select().from(applicationStates);
    expect(states).toHaveLength(6);

    const v3 = states.find((s) => s.version === 3)!;
    expect(v3.createdByAgent).toBe('bureau');
    const v3c = v3.contribution as { bureau: { score: number; hardInquiriesCount: number } };
    expect(v3c.bureau.hardInquiriesCount).toBe(1);
    expect(v3c.bureau.score).toBe(target.equifaxBaseScore - HARD_INQUIRY_PENALTY);

    const v4 = states.find((s) => s.version === 4)!;
    expect(v4.createdByAgent).toBe('alt_score');
    const v4c = v4.contribution as { alt_score: { score: number; signals: string[] } };
    expect(v4c.alt_score.score).toBe(target.altScore!.score);

    const v5 = states.find((s) => s.version === 5)!;
    expect(v5.createdByAgent).toBe('policy');
    const v5c = v5.contribution as { policy: { applies: string[]; notes: string } };
    expect(v5c.policy.applies).toEqual(['MIC-003']);
  });

  it('parallel branch one failing does NOT change the other branch version', async () => {
    // alt_score in sin_data mode → DomainError. bureau succeeds. The failing
    // branch does not "shift up" bureau's version; v3 stays bureau (array order).
    setAltScoreMode('sin_data');

    const tracer = new RecordingTracer();
    const target = personas.find(
      (p) => p.employment !== undefined && p.altScore !== undefined,
    )!;

    const intake = await intakeService.execute(
      {
        cedula: target.cedula,
        ingresos: 1500,
        monto: 3000,
        plazo: 24,
      },
      { tracer },
    );

    await expect(
      runOrchestrator(intake.applicationId, { tracer }, defaultPipeline),
    ).rejects.toBeInstanceOf(DomainError);

    // intake (v0), identity (v1), income (v2), bureau (v3 — pre-assigned even
    // though alt_score failed at v4), saga row (v5 because bureau was compensated)
    const states = await db
      .select()
      .from(applicationStates)
      .orderBy(applicationStates.version);

    const v3 = states.find((s) => s.version === 3);
    expect(v3?.createdByAgent).toBe('bureau');

    // alt_score failed — no v4 row from alt_score
    const altScoreRows = states.filter((s) => s.createdByAgent === 'alt_score');
    expect(altScoreRows).toHaveLength(0);

    // Saga compensated bureau; the row sits at v4 (next free version after the
    // last successful contribution, not v5)
    const saga = states.find((s) => s.createdByAgent === 'orchestrator');
    expect(saga).toBeDefined();
    const sagaContribution = saga!.contribution as {
      __saga: { compensated: string[] };
    };
    expect(sagaContribution.__saga.compensated).toContain('bureau');
  });
});

describe('runOrchestrator — saga walk-back', () => {
  it('compensates bureau when a downstream agent fails, restores hard inquiry', async () => {
    const tracer = new RecordingTracer();
    // Need both employment AND altScore to make the parallel step succeed
    const target = personas.find(
      (p) => p.employment !== undefined && p.altScore !== undefined,
    )!;

    const intake = await intakeService.execute(
      {
        cedula: target.cedula,
        ingresos: 1500,
        monto: 3000,
        plazo: 24,
      },
      { tracer },
    );

    const pipelineWithFailure = [
      identityAgent,
      incomeAgent,
      [bureauAgent, altScoreAgent],
      failingTestAgent,
    ];

    await expect(
      runOrchestrator(intake.applicationId, { tracer }, pipelineWithFailure),
    ).rejects.toBeInstanceOf(OperationalError);

    // intake, identity, income, bureau, alt_score, saga
    const states = await db
      .select()
      .from(applicationStates)
      .orderBy(applicationStates.version);
    expect(states).toHaveLength(6);

    const sagaRow = states[states.length - 1];
    expect(sagaRow.createdByAgent).toBe('orchestrator');
    const sagaContribution = sagaRow.contribution as {
      __saga: { compensated: string[]; reason: string; completedAt: string };
    };
    // bureau has compensate(), alt_score does not — only bureau in the list
    expect(sagaContribution.__saga.compensated).toEqual(['bureau']);
    expect(sagaContribution.__saga.reason).toContain('failing_test_agent');
    expect(sagaContribution.__saga.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Side-effect was reverted: the next hard pull should look like the first
    const nextPull = await getEquifaxClient().requestHardPull(target.cedula);
    expect(nextPull.hardInquiriesCount).toBe(1);
  });

  it('does NOT write a saga row when nothing succeeded yet (identity fails first)', async () => {
    const tracer = new RecordingTracer();

    const intake = await intakeService.execute(
      {
        cedula: cedulasNotFound[0],
        ingresos: 1500,
        monto: 3000,
        plazo: 24,
      },
      { tracer },
    );

    await expect(
      runOrchestrator(intake.applicationId, { tracer }, defaultPipeline),
    ).rejects.toBeInstanceOf(DomainError);

    const states = await db.select().from(applicationStates);
    expect(states).toHaveLength(1); // only intake v0
    const sagaRow = states.find((s) => s.createdByAgent === 'orchestrator');
    expect(sagaRow).toBeUndefined();
  });
});

describe('runOrchestrator — failure mode', () => {
  it('does not persist v1 when identity throws DomainError', async () => {
    const tracer = new RecordingTracer();

    const intake = await intakeService.execute(
      {
        cedula: cedulasNotFound[0],
        ingresos: 1500,
        monto: 3000,
        plazo: 24,
      },
      { tracer },
    );

    await expect(
      runOrchestrator(intake.applicationId, { tracer }, defaultPipeline),
    ).rejects.toBeInstanceOf(DomainError);

    const states = await db.select().from(applicationStates);
    expect(states).toHaveLength(1);
    expect(states[0].version).toBe(0);
  });

  it('does not persist v1 when registro civil mock is in error_500 mode', async () => {
    setRegistroCivilMode('error_500');
    const tracer = new RecordingTracer();

    const intake = await intakeService.execute(
      {
        cedula: personas[0].cedula,
        ingresos: 1500,
        monto: 3000,
        plazo: 24,
      },
      { tracer },
    );

    await expect(
      runOrchestrator(intake.applicationId, { tracer }, defaultPipeline),
    ).rejects.toBeInstanceOf(OperationalError);

    const states = await db.select().from(applicationStates);
    expect(states).toHaveLength(1);
  });
});
