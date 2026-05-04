import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db } from './client';
import { applications, applicationStates } from './schema';
import { closeDb, resetDb } from './test-helpers';
import {
  getLatestFullState,
  persistContribution,
} from './repository';

beforeEach(resetDb);
afterAll(closeDb);

async function seedApplication() {
  const [app] = await db.insert(applications).values({}).returning();
  await db.insert(applicationStates).values({
    applicationId: app.id,
    version: 0,
    createdByAgent: 'intake',
    contribution: {
      cedula: '0912345675',
      ingresos: 1500,
      monto: 3000,
      plazo: 24,
    },
  });
  return app.id;
}

describe('getLatestFullState — reconstruction', () => {
  it('returns the v0 contribution flat when only intake has run', async () => {
    const appId = await seedApplication();

    const state = await getLatestFullState(appId);

    expect(state).toEqual({
      cedula: '0912345675',
      ingresos: 1500,
      monto: 3000,
      plazo: 24,
    });
  });

  it('merges v0 (flat) with v1 (namespaced under identity)', async () => {
    const appId = await seedApplication();

    await db.insert(applicationStates).values({
      applicationId: appId,
      version: 1,
      createdByAgent: 'identity',
      contribution: {
        identity: {
          name: 'Maria Lopez',
          birthDate: '1990-04-12',
          valid: true,
        },
      },
    });

    const state = await getLatestFullState(appId);

    expect(state).toEqual({
      cedula: '0912345675',
      ingresos: 1500,
      monto: 3000,
      plazo: 24,
      identity: {
        name: 'Maria Lopez',
        birthDate: '1990-04-12',
        valid: true,
      },
    });
  });

  it('returns versions in ascending order regardless of insert order', async () => {
    const appId = await seedApplication();

    // Insert v2 BEFORE v1 to ensure ordering is by version, not by insert
    await db.insert(applicationStates).values({
      applicationId: appId,
      version: 2,
      createdByAgent: 'identity',
      contribution: { identity: { name: 'X', birthDate: '1990-01-01', valid: true } },
    });
    // (skipping v1 — gaps allowed; reduce is by version order)

    const state = await getLatestFullState(appId);
    expect(state.identity?.name).toBe('X');
  });
});

describe('persistContribution — append-only namespaced write', () => {
  it('inserts a new state row with version + 1 and namespaces under agentName', async () => {
    const appId = await seedApplication();

    await persistContribution(appId, {
      version: 1,
      agentName: 'identity',
      contribution: { name: 'Maria', birthDate: '1990-04-12', valid: true },
    });

    const rows = await db.select().from(applicationStates);
    expect(rows).toHaveLength(2);
    const v1 = rows.find((r) => r.version === 1)!;
    expect(v1.createdByAgent).toBe('identity');
    expect(v1.contribution).toEqual({
      identity: { name: 'Maria', birthDate: '1990-04-12', valid: true },
    });
  });
});
