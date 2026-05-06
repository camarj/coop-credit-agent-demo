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
  it('returns 200 with version=5 when full pipeline succeeds (intake + identity + income + [bureau ‖ alt_score] + policy)', async () => {
    const response = await POST(buildRequest(validInput));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(typeof json.applicationId).toBe('string');
    expect(json.version).toBe(5);

    const apps = await db.select().from(applications);
    expect(apps).toHaveLength(1);
    expect(apps[0].id).toBe(json.applicationId);

    const states = await db.select().from(applicationStates);
    expect(states).toHaveLength(6);
  });

  it('returns 200 with version=0 when cedula is not in dataset (intake ok, identity DomainError)', async () => {
    const response = await POST(
      buildRequest({ ...validInput, cedula: cedulasNotFound[0] }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.applicationId).toBeDefined();
    expect(json.version).toBe(0);

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
