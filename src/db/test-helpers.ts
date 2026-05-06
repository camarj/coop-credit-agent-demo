import { sql } from 'drizzle-orm';
import { db, pool } from './client';

/** Wipes all rows. Allowed in tests because TRUNCATE bypasses the immutability triggers. */
export async function resetDb(): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE application_states, application_token_usage, applications CASCADE`,
  );
}

/** Wipes the RAG corpus table — used by retriever tests that seed fake chunks. */
export async function resetRagChunks(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE rag_chunks`);
}

/** Closes the underlying connection pool — call from `afterAll` to let vitest exit cleanly. */
export async function closeDb(): Promise<void> {
  await pool.end();
}
