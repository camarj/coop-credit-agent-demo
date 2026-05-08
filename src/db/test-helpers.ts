import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { db, pool } from './client';
import { ingestCorpus } from '@/lib/rag/ingest';
import { createOpenAIEmbedClient } from '@/lib/rag/embed-client';

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

/**
 * Repopulates rag_chunks with the real policy corpus. Tests that truncate
 * the table (ingest.test.ts, retriever.test.ts) call this from afterAll
 * so that the dev DB they share with `pnpm dev` does not stay empty after
 * the suite runs. Without it, the next live demo would show "ninguna regla"
 * because the policyAgent's RAG retriever would return [].
 *
 * Skipped silently when OPENAI_API_KEY is missing (CI without secrets).
 */
export async function repopulateRagCorpus(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) return;
  try {
    const corpusPath = path.resolve(
      process.cwd(),
      'docs/policy/cooperativa-policy.md',
    );
    const source = readFileSync(corpusPath, 'utf-8');
    const embedClient = createOpenAIEmbedClient({
      apiKey: process.env.OPENAI_API_KEY,
    });
    await ingestCorpus({ db, embedClient, source });
  } catch {
    // Best-effort restore. If something fails, the dev can run
    // `pnpm rag:ingest` manually.
  }
}
