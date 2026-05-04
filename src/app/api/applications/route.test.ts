import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { POST } from './route';
import { closeDb, resetDb } from '@/db/test-helpers';
import { db } from '@/db/client';
import { applications } from '@/db/schema';

beforeEach(resetDb);
afterAll(closeDb);

const validInput = {
  cedula: '1712345678',
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
  it('returns 200 with applicationId + version=0 for valid input', async () => {
    const response = await POST(buildRequest(validInput));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(typeof json.applicationId).toBe('string');
    expect(json.version).toBe(0);

    const apps = await db.select().from(applications);
    expect(apps).toHaveLength(1);
    expect(apps[0].id).toBe(json.applicationId);
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
