import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { POST } from './route';
import { closeDb, resetDb } from '@/db/test-helpers';
import { db } from '@/db/client';
import { applications, applicationStates } from '@/db/schema';
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

const validInput = {
  cedula: fullPipelinePersona.cedula,
  ingresos: 1500,
  monto: 3000,
  plazo: 24,
};

function buildRequest(body: unknown): Request {
  return new Request('http://localhost/api/applications', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/applications', () => {
  it('returns 200 and persists only v0 (intake) — orchestrator runs on the GET stream', async () => {
    const response = await POST(buildRequest(validInput));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(typeof json.applicationId).toBe('string');
    // V1 cutover: POST does not run the pipeline, so no `version` is returned.
    expect(json.version).toBeUndefined();

    const apps = await db.select().from(applications);
    expect(apps).toHaveLength(1);
    expect(apps[0].id).toBe(json.applicationId);

    const states = await db.select().from(applicationStates);
    expect(states).toHaveLength(1);
    expect(states[0].version).toBe(0);
    expect(states[0].createdByAgent).toBe('intake');
  });

  it('returns 200 with v0 even when cedula would later fail identity (POST does not validate identity)', async () => {
    const response = await POST(
      buildRequest({ ...validInput, cedula: cedulasNotFound[0] }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.applicationId).toBeDefined();

    // POST is intake-only: identity is enforced by the orchestrator on the
    // GET stream, where the pipeline runs and writes a __pipeline_failure
    // terminal marker.
    const states = await db.select().from(applicationStates);
    expect(states).toHaveLength(1);
    expect(states[0].version).toBe(0);
  });

  it('returns 400 when cedula is invalid', async () => {
    const response = await POST(
      buildRequest({ ...validInput, cedula: 'NOT_A_CEDULA' }),
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe('invalid_input');
    expect(json.details).toBeDefined();

    const apps = await db.select().from(applications);
    expect(apps).toHaveLength(0);
  });

  it('returns 400 when monto is below 100', async () => {
    const response = await POST(
      buildRequest({ ...validInput, monto: 50 }),
    );
    expect(response.status).toBe(400);
  });

  it('returns 400 when body is not valid JSON', async () => {
    const request = new Request('http://localhost/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});
