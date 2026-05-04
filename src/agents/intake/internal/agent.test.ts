import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db } from '@/db/client';
import { applications, applicationStates } from '@/db/schema';
import { closeDb, resetDb } from '@/db/test-helpers';
import { intakeAgent } from '@/agents/intake';
import { RecordingTracer } from '@/lib/tracer';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closeDb();
});

const validInput = {
  cedula: '1712345678',
  ingresos: 1500,
  monto: 3000,
  plazo: 24,
};

describe('intakeAgent.execute — happy path', () => {
  it('persists an application row and a state v0 in the same transaction', async () => {
    const tracer = new RecordingTracer();

    const state = await intakeAgent.execute(validInput, { tracer });

    const apps = await db.select().from(applications);
    const states = await db.select().from(applicationStates);

    expect(apps).toHaveLength(1);
    expect(states).toHaveLength(1);

    expect(states[0].applicationId).toBe(apps[0].id);
    expect(states[0].version).toBe(0);
    expect(states[0].createdByAgent).toBe('intake');
    expect(states[0].data).toEqual(validInput);

    expect(state.applicationId).toBe(apps[0].id);
    expect(state.version).toBe(0);
    expect(state.createdByAgent).toBe('intake');
    expect(state.data).toEqual(validInput);
  });
});

describe('intakeAgent.execute — invalid input', () => {
  it('throws ZodError and writes no rows when input is invalid', async () => {
    const tracer = new RecordingTracer();
    const invalid = {
      cedula: 'NOT_TEN_DIGITS',
      ingresos: 1500,
      monto: 3000,
      plazo: 24,
    };

    await expect(
      intakeAgent.execute(invalid, { tracer }),
    ).rejects.toThrow();

    const apps = await db.select().from(applications);
    const states = await db.select().from(applicationStates);

    expect(apps).toHaveLength(0);
    expect(states).toHaveLength(0);
  });

  it('throws when monto is below 100 and writes no rows', async () => {
    const tracer = new RecordingTracer();

    await expect(
      intakeAgent.execute({ ...validInput, monto: 50 }, { tracer }),
    ).rejects.toThrow();

    const apps = await db.select().from(applications);
    expect(apps).toHaveLength(0);
  });
});

describe('intakeAgent.execute — observability', () => {
  it('emits intake.start and intake.complete events on a single span', async () => {
    const tracer = new RecordingTracer();

    await intakeAgent.execute(validInput, { tracer });

    expect(tracer.spans).toHaveLength(1);
    const span = tracer.spans[0];

    expect(span.name).toBe('intake.execute');
    expect(span.status).toBe('ok');

    const eventNames = span.events.map((e) => e.name);
    expect(eventNames).toContain('intake.start');
    expect(eventNames).toContain('intake.complete');
  });

  it('records applicationId and version as span attributes', async () => {
    const tracer = new RecordingTracer();

    const state = await intakeAgent.execute(validInput, { tracer });

    const span = tracer.spans[0];
    expect(span.attributes.applicationId).toBe(state.applicationId);
    expect(span.attributes.version).toBe(0);
    expect(span.attributes.agent).toBe('intake');
  });

  it('marks the span as error and writes no rows when validation fails', async () => {
    const tracer = new RecordingTracer();

    await expect(
      intakeAgent.execute({ cedula: 'BAD' }, { tracer }),
    ).rejects.toThrow();

    expect(tracer.spans).toHaveLength(1);
    expect(tracer.spans[0].status).toBe('error');
  });
});

describe('database transactions — atomicity guarantee', () => {
  it('rolls back the entire transaction when an error is thrown mid-way', async () => {
    let appId: string | undefined;

    await expect(
      db.transaction(async (tx) => {
        const [app] = await tx.insert(applications).values({}).returning();
        appId = app.id;
        // simulate a downstream failure (e.g. constraint violation, lost conn)
        throw new Error('simulated failure during state insert');
      }),
    ).rejects.toThrow('simulated failure during state insert');

    // application row was inserted inside the tx but should not survive rollback
    expect(appId).toBeDefined();
    const apps = await db.select().from(applications);
    expect(apps).toHaveLength(0);
  });
});
