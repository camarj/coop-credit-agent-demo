import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { EmbedClient } from './embed-client';
import { parsePolicyCorpus, buildEmbeddingText } from './parser';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = NodePgDatabase<any>;

export interface IngestDeps {
  db: AnyDb;
  embedClient: EmbedClient;
  source: string;
}

export interface IngestResult {
  inserted: number;
}

/**
 * Replaces the entire `rag_chunks` table with the chunks parsed from `source`.
 *
 * Idempotent by design: running twice produces the same final state. The
 * corpus is small enough (15-50 rules at most) that a TRUNCATE + re-insert
 * is faster and simpler than tracking diffs. Atomic via transaction so a
 * mid-run failure leaves the previous corpus intact.
 */
export async function ingestCorpus(deps: IngestDeps): Promise<IngestResult> {
  const { db, embedClient, source } = deps;

  const chunks = parsePolicyCorpus(source);
  if (chunks.length === 0) {
    throw new Error(
      'ingestCorpus: corpus has no rules — refusing to TRUNCATE rag_chunks with empty source',
    );
  }

  const embeddingTexts = chunks.map(buildEmbeddingText);
  const vectors = await embedClient.embed(embeddingTexts);

  await db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE TABLE rag_chunks`);

    for (const [i, chunk] of chunks.entries()) {
      const vec = vectors[i];
      const vectorLiteral = `[${vec.join(',')}]`;
      const metadata = {
        condicion: chunk.condicion,
        accion: chunk.accion,
        justificacion: chunk.justificacion,
        tags: chunk.tags,
      };

      await tx.execute(sql`
        INSERT INTO rag_chunks (rule_id, category, title, full_text, embedding, metadata)
        VALUES (
          ${chunk.ruleId},
          ${chunk.category},
          ${chunk.title},
          ${chunk.fullText},
          ${vectorLiteral}::vector,
          ${JSON.stringify(metadata)}::jsonb
        )
      `);
    }
  });

  return { inserted: chunks.length };
}
