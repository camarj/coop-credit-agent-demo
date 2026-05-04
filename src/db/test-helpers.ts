import { sql } from 'drizzle-orm';
import { db, pool } from './client';

/** Wipes all rows. Allowed in tests because TRUNCATE bypasses the immutability triggers. */
export async function resetDb(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE application_states, applications CASCADE`);
}

/** Closes the underlying connection pool — call from `afterAll` to let vitest exit cleanly. */
export async function closeDb(): Promise<void> {
  await pool.end();
}
