import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { applications, applicationStates } from '@/db/schema';
import { closeDb, resetDb } from '@/db/test-helpers';

beforeEach(resetDb);
afterAll(closeDb);

async function seedApplication() {
  const [app] = await db.insert(applications).values({}).returning();
  const [state] = await db
    .insert(applicationStates)
    .values({
      applicationId: app.id,
      version: 0,
      createdByAgent: 'test',
      contribution: { seed: true },
    })
    .returning();
  return { app, state };
}

describe('immutability triggers — applications', () => {
  it('rejects UPDATE on applications', async () => {
    const { app } = await seedApplication();

    await expect(
      db.execute(
        sql`UPDATE applications SET created_at = now() WHERE id = ${app.id}::uuid`,
      ),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/immutable/) },
    });
  });

  it('rejects DELETE on applications', async () => {
    const { app } = await seedApplication();

    await expect(
      db.execute(sql`DELETE FROM applications WHERE id = ${app.id}::uuid`),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/immutable/) },
    });
  });
});

describe('immutability triggers — application_states', () => {
  it('rejects UPDATE on application_states', async () => {
    const { state } = await seedApplication();

    await expect(
      db.execute(
        sql`UPDATE application_states SET contribution = '{"mutated": true}'::jsonb WHERE id = ${state.id}::uuid`,
      ),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/immutable/) },
    });
  });

  it('rejects DELETE on application_states', async () => {
    const { state } = await seedApplication();

    await expect(
      db.execute(
        sql`DELETE FROM application_states WHERE id = ${state.id}::uuid`,
      ),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/immutable/) },
    });
  });
});

describe('immutability triggers — TRUNCATE bypass for cleanup', () => {
  it('allows TRUNCATE to bypass triggers (used by tests)', async () => {
    await seedApplication();

    // resetDb uses TRUNCATE under the hood; triggers do not fire on it
    await resetDb();

    const apps = await db.select().from(applications);
    const states = await db.select().from(applicationStates);
    expect(apps).toHaveLength(0);
    expect(states).toHaveLength(0);
  });
});
