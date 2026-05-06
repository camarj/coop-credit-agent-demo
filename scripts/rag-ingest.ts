/**
 * Standalone script: ingest the policy corpus into pgvector.
 *
 * Usage: `pnpm rag:ingest`
 *
 * Reads `docs/policy/cooperativa-policy.md`, parses each rule as a chunk,
 * embeds them in a single OpenAI batch, and TRUNCATEs + INSERTs into
 * `rag_chunks`. Atomic via transaction.
 *
 * Idempotent: re-running replaces the corpus. Cost: ~$0.001 USD per run.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

// .env.local is loaded by `tsx --env-file-if-exists` flag (see package.json).
// Ensure DATABASE_URL and OPENAI_API_KEY are present before any imports
// that read process.env at module-load time (db/client.ts does).

import { db, pool } from '@/db/client';
import { createOpenAIEmbedClient } from '@/lib/rag/embed-client';
import { ingestCorpus } from '@/lib/rag/ingest';

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY is not set. Add it to .env.local');
    process.exit(1);
  }

  const corpusPath = path.resolve(
    process.cwd(),
    'docs/policy/cooperativa-policy.md',
  );
  const source = readFileSync(corpusPath, 'utf-8');

  const embedClient = createOpenAIEmbedClient({ apiKey });

  console.log('Ingesting policy corpus...');
  const t0 = Date.now();
  const { inserted } = await ingestCorpus({ db, embedClient, source });
  const elapsed = Date.now() - t0;

  console.log(`Inserted ${inserted} chunks in ${elapsed}ms.`);
  await pool.end();
}

main().catch((err) => {
  console.error('Ingest failed:', err);
  process.exit(1);
});
