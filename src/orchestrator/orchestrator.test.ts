import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db } from '@/db/client';
import { applications, applicationStates } from '@/db/schema';
import { closeDb, resetDb } from '@/db/test-helpers';
import { intakeService } from '@/services/intake';
import { __resetForTesting, setMode } from '@/services/mocks/registro-civil';
import { personas, cedulasNotFound } from '@/services/mocks/_dataset/personas';
import { RecordingTracer } from '@/lib/tracer';
import { runOrchestrator } from './index';
import { OperationalError, DomainError } from '@/lib/errors';

beforeEach(async () => {
  await resetDb();
  __resetForTesting();
});

afterAll(closeDb);

describe('runOrchestrator — happy path through identity', () => {
  it('produces state v1 with identity contribution namespaced', async () => {
    const tracer = new RecordingTracer();
    const target = personas[0];

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
    expect(states).toHaveLength(2);

    const v1 = states.find((s) => s.version === 1)!;
    expect(v1.createdByAgent).toBe('identity');
    expect(v1.contribution).toEqual({
      identity: {
        name: target.name,
        birthDate: target.birthDate,
        valid: true,
      },
    });
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
    setMode('error_500');
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
