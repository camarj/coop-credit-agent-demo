import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { EmbedClient } from './embed-client';
import type { PolicyChunk, PolicyCategory, RetrievedChunk } from './types';

/**
 * The retriever only needs query execution capabilities, not knowledge of the
 * specific schema. Using a permissive type avoids tight coupling and allows
 * the same instance to be used regardless of how the consumer typed their
 * drizzle instance.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = NodePgDatabase<any>;

/**
 * Top-level contract of the RAG layer for downstream agents.
 *
 * `retrieve` is the only entry point that touches OpenAI + pgvector.
 * `rerank` operates on already-retrieved chunks — today it does sort + dedupe
 * + topN cap, tomorrow (when eval data warrants it) it can swap to a
 * cross-encoder without changing callers. See ADR-0007 section 4c.
 */
export interface RAGRetriever {
  retrieve(query: string, k: number): Promise<RetrievedChunk[]>;
  rerank(
    chunks: RetrievedChunk[],
    query: string,
    topN?: number,
  ): Promise<RetrievedChunk[]>;
}

export interface RAGRetrieverDeps {
  db: AnyDb;
  embedClient: EmbedClient;
}

interface RawChunkRow extends Record<string, unknown> {
  rule_id: string;
  category: string;
  title: string;
  full_text: string;
  metadata: {
    condicion?: string;
    accion?: string;
    justificacion?: string;
    tags?: string[];
  };
  cosine_distance: string; // returned as string by pg, parse to number
}

export function createRAGRetriever(deps: RAGRetrieverDeps): RAGRetriever {
  const { db, embedClient } = deps;

  return {
    async retrieve(query: string, k: number): Promise<RetrievedChunk[]> {
      if (!Number.isInteger(k) || k <= 0) {
        throw new Error(
          `RAGRetriever.retrieve: k must be a positive integer (got ${k})`,
        );
      }

      const [queryVec] = await embedClient.embed([query]);
      const vectorLiteral = `[${queryVec.join(',')}]`;

      // pgvector cosine DISTANCE operator `<=>`: smaller is closer.
      // We convert distance → similarity = 1 - distance so callers see scores
      // in [0, 1] with higher = better, matching the public RetrievedChunk shape.
      const result = await db.execute<RawChunkRow>(sql`
        SELECT rule_id, category, title, full_text, metadata,
               (embedding <=> ${vectorLiteral}::vector) AS cosine_distance
        FROM rag_chunks
        ORDER BY embedding <=> ${vectorLiteral}::vector
        LIMIT ${k}
      `);

      return result.rows.map((row) => hydrateChunk(row));
    },

    async rerank(
      chunks: RetrievedChunk[],
      _query: string,
      topN?: number,
    ): Promise<RetrievedChunk[]> {
      if (chunks.length === 0) return [];

      // Dedupe by rule_id, NOT by content hash. Hoy es trivial (1 chunk por
      // regla); este invariante se mantiene cuando el corpus crezca y aparezcan
      // reglas multi-chunk porque su body excede el max_tokens del embedding model.
      const bestPerRule = new Map<string, RetrievedChunk>();
      for (const r of chunks) {
        const existing = bestPerRule.get(r.chunk.ruleId);
        if (!existing || r.score > existing.score) {
          bestPerRule.set(r.chunk.ruleId, r);
        }
      }

      // Stable sort: array iteration order preserves insertion when scores tie.
      const sorted = [...bestPerRule.values()].sort((a, b) => b.score - a.score);

      return topN !== undefined ? sorted.slice(0, topN) : sorted;
    },
  };
}

function hydrateChunk(row: RawChunkRow): RetrievedChunk {
  const distance = Number(row.cosine_distance);
  // pgvector distance is in [0, 2] for unit vectors; clamp to [0, 1] just in case.
  const similarity = Math.max(0, Math.min(1, 1 - distance));

  const chunk: PolicyChunk = {
    ruleId: row.rule_id,
    category: row.category as PolicyCategory,
    title: row.title,
    condicion: row.metadata?.condicion ?? '',
    accion: row.metadata?.accion ?? '',
    justificacion: row.metadata?.justificacion ?? '',
    tags: row.metadata?.tags ?? [],
    fullText: row.full_text,
  };

  return { chunk, score: similarity };
}
