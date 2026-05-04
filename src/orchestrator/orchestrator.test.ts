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
  setMode as setIessMode,
} from '@/services/mocks/iess';
import { personas, cedulasNotFound } from '@/services/mocks/_dataset/personas';
import { RecordingTracer } from '@/lib/tracer';
import { runOrchestrator } from './index';
import { OperationalError, DomainError } from '@/lib/errors';

beforeEach(async () => {
  await resetDb();
  resetRegistroCivil();
  resetIess();
});

afterAll(closeDb);

describe('runOrchestrator — happy path through identity + income', () => {
  it('produces state v1 (identity) and v2 (income) namespaced', async () => {
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

    await runOrchestrator(intake.applicationId, { tracer });

    const states = await db.select().from(applicationStates);
    expect(states).toHaveLength(3);

    const v1 = states.find((s) => s.version === 1)!;
    expect(v1.createdByAgent).toBe('identity');
    expect(v1.contribution).toEqual({
      identity: {
        name: target.name,
        birthDate: target.birthDate,
        valid: true,
      },
    });

    const v2 = states.find((s) => s.version === 2)!;
    expect(v2.createdByAgent).toBe('income');
    expect(v2.contribution).toEqual({
      income: {
        employer: target.employment!.employer,
        salary: target.employment!.salary,
        monthsActive: target.employment!.monthsActive,
      },
    });
  });
});

describe('runOrchestrator — income failure leaves state at v1', () => {
  it('persists v1 but not v2 when persona is autónomo (sin_afiliacion)', async () => {
    const tracer = new RecordingTracer();
    const autonomo = personas.find(
      (p) => p.employment === undefined && p.deathDate === undefined,
    )!;

    const intake = await intakeService.execute(
      {
        cedula: autonomo.cedula,
        ingresos: 1500,
        monto: 3000,
        plazo: 24,
      },
      { tracer },
    );

    await expect(
      runOrchestrator(intake.applicationId, { tracer }),
    ).rejects.toBeInstanceOf(DomainError);

    const states = await db.select().from(applicationStates);
    expect(states).toHaveLength(2);
    expect(states.map((s) => s.version).sort()).toEqual([0, 1]);
  });
});

describe('runOrchestrator — failure mode leaves state at v0', () => {
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
      runOrchestrator(intake.applicationId, { tracer }),
    ).rejects.toBeInstanceOf(DomainError);

    const states = await db.select().from(applicationStates);
    expect(states).toHaveLength(1);
    expect(states[0].version).toBe(0);
  });

  it('does not persist v1 when mock is in error_500 mode', async () => {
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
      runOrchestrator(intake.applicationId, { tracer }),
    ).rejects.toBeInstanceOf(OperationalError);

    const states = await db.select().from(applicationStates);
    expect(states).toHaveLength(1);
  });
});
