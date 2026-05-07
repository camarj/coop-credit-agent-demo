import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { GET } from './route';
import { closeDb, resetDb } from '@/db/test-helpers';
import { intakeService } from '@/services/intake';
import { ConsoleTracer } from '@/lib/tracer';
import { db } from '@/db/client';
import { applicationStates } from '@/db/schema';
import { eq, asc } from 'drizzle-orm';
import { streamEventSchema, type StreamEvent } from '@/lib/streaming/event-schema';
import { __resetForTesting as resetRegistroCivil } from '@/services/mocks/registro-civil';
import { __resetForTesting as resetIess } from '@/services/mocks/iess';
import { __resetForTesting as resetEquifax } from '@/services/mocks/equifax';
import { __resetForTesting as resetAltScore } from '@/services/mocks/score-alternativo';
import { personas, cedulasNotFound } from '@/services/mocks/_dataset/personas';

beforeEach(async () => {
  await resetDb();
  resetRegistroCivil();
  resetIess();
  resetEquifax();
  resetAltScore();
});
afterAll(closeDb);

const fullPipelinePersona = personas.find(
  (p) => p.employment !== undefined && p.altScore !== undefined,
)!;

async function seedIntake(): Promise<string> {
  const tracer = new ConsoleTracer();
  const state = await intakeService.execute(
    {
      cedula: fullPipelinePersona.cedula,
      ingresos: 1500,
      monto: 3000,
      plazo: 24,
    },
    { tracer },
  );
  return state.applicationId;
}

function buildRequest(applicationId: string, signal?: AbortSignal): {
  request: Request;
  params: Promise<{ id: string }>;
} {
  return {
    request: new Request(`http://localhost/api/applications/${applicationId}/stream`, { signal }),
    params: Promise.resolve({ id: applicationId }),
  };
}

async function readAllEvents(response: Response): Promise<StreamEvent[]> {
  const text = await response.text();
  const events: StreamEvent[] = [];
  for (const block of text.split('\n\n')) {
    const trimmed = block.trim();
    if (!trimmed.startsWith('data:')) continue;
    const json = trimmed.slice(5).trim();
    const parsed = streamEventSchema.parse(JSON.parse(json));
    events.push(parsed);
  }
  return events;
}

describe('GET /api/applications/[id]/stream — input validation', () => {
  it('returns 400 when id is not a uuid', async () => {
    const { request, params } = buildRequest('not-a-uuid');
    const response = await GET(request, { params });
    expect(response.status).toBe(400);
  });

  it('returns 404 when application does not exist', async () => {
    const { request, params } = buildRequest('00000000-0000-0000-0000-000000000000');
    const response = await GET(request, { params });
    expect(response.status).toBe(404);
  });
});

describe('GET /api/applications/[id]/stream — happy path', () => {
  it('streams events that all validate against streamEventSchema', async () => {
    const applicationId = await seedIntake();
    const { request, params } = buildRequest(applicationId);

    const response = await GET(request, { params });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const events = await readAllEvents(response);
    expect(events.length).toBeGreaterThan(0);
  });

  it('emits orchestrator.complete as the terminal event when pipeline succeeds', async () => {
    const applicationId = await seedIntake();
    const { request, params } = buildRequest(applicationId);

    const response = await GET(request, { params });
    const events = await readAllEvents(response);

    expect(events[events.length - 1].kind).toBe('orchestrator.complete');
  });

  it('emits at least one span.start for identity (first agent of the pipeline)', async () => {
    const applicationId = await seedIntake();
    const { request, params } = buildRequest(applicationId);

    const response = await GET(request, { params });
    const events = await readAllEvents(response);

    const identityStarts = events.filter(
      (e) => e.kind === 'span.start' && e.agent === 'identity',
    );
    expect(identityStarts.length).toBeGreaterThanOrEqual(1);
  });

  it('persists v6 in the DB when the pipeline runs end-to-end', async () => {
    const applicationId = await seedIntake();
    const { request, params } = buildRequest(applicationId);

    await GET(request, { params }).then((r) => r.text()); // drain

    const states = await db
      .select()
      .from(applicationStates)
      .where(eq(applicationStates.applicationId, applicationId))
      .orderBy(asc(applicationStates.version));

    const lastVersion = states[states.length - 1].version;
    expect(lastVersion).toBe(6);
  });
});

describe('GET /api/applications/[id]/stream — already_complete short-circuit', () => {
  it('emits already_complete and closes when the application already has a decision', async () => {
    const applicationId = await seedIntake();
    // Run once so the pipeline persists v6 (decision)
    const first = buildRequest(applicationId);
    await GET(first.request, { params: first.params }).then((r) => r.text());

    // Second open should short-circuit
    const second = buildRequest(applicationId);
    const response = await GET(second.request, { params: second.params });
    const events = await readAllEvents(response);

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('already_complete');
  });
});

describe('GET /api/applications/[id]/stream — domain failures', () => {
  it('emits orchestrator.failed when identity fails (cedula not in dataset)', async () => {
    const tracer = new ConsoleTracer();
    const state = await intakeService.execute(
      {
        cedula: cedulasNotFound[0],
        ingresos: 1500,
        monto: 3000,
        plazo: 24,
      },
      { tracer },
    );
    const { request, params } = buildRequest(state.applicationId);

    const response = await GET(request, { params });
    const events = await readAllEvents(response);

    expect(events[events.length - 1].kind).toBe('orchestrator.failed');
  });
});
