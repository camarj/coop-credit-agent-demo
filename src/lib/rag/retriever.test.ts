import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { ragChunks } from '@/db/schema';
import { closeDb, resetRagChunks, repopulateRagCorpus } from '@/db/test-helpers';
import { createRAGRetriever } from './retriever';
import type { EmbedClient } from './embed-client';
import type { RetrievedChunk } from './types';

const DIM = 1536;

/** Builds a unit vector with a 1 at the given index, 0 elsewhere. */
function unitVec(hotIndex: number): number[] {
  const v = new Array(DIM).fill(0);
  v[hotIndex] = 1;
  return v;
}

/** Builds a vector mostly aligned with one axis, with small noise on another. */
function biasedVec(hotIndex: number, secondaryIndex: number): number[] {
  const v = new Array(DIM).fill(0);
  v[hotIndex] = 0.99;
  v[secondaryIndex] = 0.14;
  return v;
}

/**
 * Inserts a fake chunk straight into rag_chunks bypassing the ingest pipeline.
 * Tests only care about retrieval mechanics — embedding correctness is the
 * embed-client's responsibility, not the retriever's.
 */
async function seedChunk(args: {
  ruleId: string;
  category: string;
  embedding: number[];
}) {
  const vectorLiteral = `[${args.embedding.join(',')}]`;
  await db.execute(sql`
    INSERT INTO rag_chunks (rule_id, category, title, full_text, embedding, metadata)
    VALUES (
      ${args.ruleId},
      ${args.category},
      ${`Title for ${args.ruleId}`},
      ${`Full text for ${args.ruleId}`},
      ${vectorLiteral}::vector,
      ${sql`'{}'::jsonb`}
    )
  `);
}

function fakeEmbedClient(returnVector: number[]): EmbedClient {
  return {
    embed: vi.fn().mockResolvedValue([returnVector]),
  };
}

beforeEach(async () => {
  await resetRagChunks();
});

afterAll(async () => {
  await repopulateRagCorpus();
  await closeDb();
});

describe('RAGRetriever — retrieve', () => {
  it('returns the top-K chunks ordered by cosine similarity descending', async () => {
    // Seed 3 chunks with orthogonal embeddings.
    await seedChunk({ ruleId: 'TST-001', category: 'MIC', embedding: unitVec(0) });
    await seedChunk({ ruleId: 'TST-002', category: 'MIC', embedding: unitVec(1) });
    await seedChunk({ ruleId: 'TST-003', category: 'GAR', embedding: unitVec(2) });

    // Query embedding is biased toward axis 0 with mild secondary on axis 2.
    const queryVec = biasedVec(0, 2);
    const retriever = createRAGRetriever({ db, embedClient: fakeEmbedClient(queryVec) });

    const result = await retriever.retrieve('soy autonomo', 2);

    expect(result).toHaveLength(2);
    expect(result[0].chunk.ruleId).toBe('TST-001'); // closest (axis 0)
    expect(result[1].chunk.ruleId).toBe('TST-003'); // second (axis 2 secondary)
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it('returns scores in [0, 1] range (cosine similarity)', async () => {
    await seedChunk({ ruleId: 'TST-001', category: 'MIC', embedding: unitVec(0) });
    await seedChunk({ ruleId: 'TST-002', category: 'MIC', embedding: unitVec(1) });

    const retriever = createRAGRetriever({
      db,
      embedClient: fakeEmbedClient(unitVec(0)),
    });
    const result = await retriever.retrieve('q', 2);

    for (const r of result) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
    // Same axis as TST-001 → score very close to 1
    expect(result[0].score).toBeGreaterThan(0.99);
  });

  it('returns all chunks when K is larger than corpus size', async () => {
    await seedChunk({ ruleId: 'TST-001', category: 'MIC', embedding: unitVec(0) });
    await seedChunk({ ruleId: 'TST-002', category: 'GAR', embedding: unitVec(1) });

    const retriever = createRAGRetriever({
      db,
      embedClient: fakeEmbedClient(unitVec(0)),
    });
    const result = await retriever.retrieve('q', 10);

    expect(result).toHaveLength(2); // not 10
  });

  it('hydrates the full PolicyChunk shape from rag_chunks rows', async () => {
    await seedChunk({ ruleId: 'TST-001', category: 'MIC', embedding: unitVec(0) });

    const retriever = createRAGRetriever({
      db,
      embedClient: fakeEmbedClient(unitVec(0)),
    });
    const [first] = await retriever.retrieve('q', 1);

    expect(first.chunk.ruleId).toBe('TST-001');
    expect(first.chunk.category).toBe('MIC');
    expect(first.chunk.title).toContain('TST-001');
    expect(first.chunk.fullText).toContain('TST-001');
  });

  it('rejects K <= 0 — caller bug', async () => {
    const retriever = createRAGRetriever({
      db,
      embedClient: fakeEmbedClient(unitVec(0)),
    });
    await expect(retriever.retrieve('q', 0)).rejects.toThrow(/k/i);
    await expect(retriever.retrieve('q', -1)).rejects.toThrow(/k/i);
  });
});

describe('RAGRetriever — rerank', () => {
  it('returns chunks sorted by score descending (stable sort)', async () => {
    const retriever = createRAGRetriever({
      db,
      embedClient: fakeEmbedClient(unitVec(0)),
    });

    const input: RetrievedChunk[] = [
      makeRetrieved('A', 0.5),
      makeRetrieved('B', 0.9),
      makeRetrieved('C', 0.7),
    ];
    const result = await retriever.rerank(input, 'q');

    expect(result.map((r) => r.chunk.ruleId)).toEqual(['B', 'C', 'A']);
  });

  it('dedupes by rule_id (keeps highest score per ruleId)', async () => {
    // Today every retrieve() returns at most 1 chunk per ruleId because each
    // rule is 1 chunk. The dedupe invariant matters for the future where a
    // long rule may be split into condicion + accion chunks (multi-chunk rule).
    const retriever = createRAGRetriever({
      db,
      embedClient: fakeEmbedClient(unitVec(0)),
    });
    const input: RetrievedChunk[] = [
      makeRetrieved('A', 0.5),
      makeRetrieved('A', 0.9), // duplicate — keep this one
      makeRetrieved('B', 0.7),
    ];
    const result = await retriever.rerank(input, 'q');

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.chunk.ruleId)).toEqual(['A', 'B']);
    expect(result[0].score).toBe(0.9);
  });

  it('caps results to topN when provided', async () => {
    const retriever = createRAGRetriever({
      db,
      embedClient: fakeEmbedClient(unitVec(0)),
    });
    const input: RetrievedChunk[] = [
      makeRetrieved('A', 0.9),
      makeRetrieved('B', 0.8),
      makeRetrieved('C', 0.7),
      makeRetrieved('D', 0.6),
    ];
    const result = await retriever.rerank(input, 'q', 2);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.chunk.ruleId)).toEqual(['A', 'B']);
  });

  it('returns empty array unchanged', async () => {
    const retriever = createRAGRetriever({
      db,
      embedClient: fakeEmbedClient(unitVec(0)),
    });
    const result = await retriever.rerank([], 'q');
    expect(result).toEqual([]);
  });
});

function makeRetrieved(ruleId: string, score: number): RetrievedChunk {
  return {
    chunk: {
      ruleId,
      category: 'MIC',
      title: `Title ${ruleId}`,
      condicion: 'cond',
      accion: 'acc',
      justificacion: 'just',
      tags: ['t'],
      fullText: `## Regla ${ruleId}`,
    },
    score,
  };
}
