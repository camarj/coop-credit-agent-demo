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
});

afterAll(closeDb);

describe('runOrchestrator — happy path identity → income → bureau', () => {
  it('produces v1, v2, v3 with bureau showing baseScore − one penalty', async () => {
    const tracer = new RecordingTracer();
    const target = personas.find((p) => p.employment !== undefined)!;

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
    expect(states).toHaveLength(4);

    const v3 = states.find((s) => s.version === 3)!;
    expect(v3.createdByAgent).toBe('bureau');
    const bureauContribution = v3.contribution as { bureau: { score: number; hardInquiriesCount: number } };
    expect(bureauContribution.bureau.hardInquiriesCount).toBe(1);
    expect(bureauContribution.bureau.score).toBe(
      target.equifaxBaseScore - HARD_INQUIRY_PENALTY,
    );
  });
});

describe('runOrchestrator — saga walk-back', () => {
  it('compensates bureau when a downstream agent fails, restores hard inquiry', async () => {
    const tracer = new RecordingTracer();
    const target = personas.find((p) => p.employment !== undefined)!;

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
      bureauAgent,
      failingTestAgent,
    ];

    await expect(
      runOrchestrator(intake.applicationId, { tracer }, pipelineWithFailure),
    ).rejects.toBeInstanceOf(OperationalError);

    // Verify v0..v3 persisted, plus v4 saga row
    const states = await db
      .select()
      .from(applicationStates)
      .orderBy(applicationStates.version);
    expect(states).toHaveLength(5); // intake, identity, income, bureau, saga

    const sagaRow = states[states.length - 1];
    expect(sagaRow.createdByAgent).toBe('orchestrator');
    const sagaContribution = sagaRow.contribution as {
      __saga: { compensated: string[]; reason: string; completedAt: string };
    };
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
