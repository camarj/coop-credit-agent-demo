import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  policyAgent,
  __setDepsForTesting,
  __resetForTesting,
  buildRetrievalQuery,
} from './agent';
import { DomainError, OperationalError } from '@/lib/errors';
import type { RAGRetriever } from '@/lib/rag/retriever';
import type { LlmClient } from '@/lib/llm';
import type { RetrievedChunk } from '@/lib/rag/types';
import { RecordingTracer } from '@/lib/tracer';

const baseInput = {
  cedula: '0102030405',
  ingresos: 1500,
  monto: 3000,
  plazo: 24,
  identity: { name: 'Maria Lopez', birthDate: '1985-04-12', valid: true },
  income: { employer: 'Banco Pichincha', salary: 1450, monthsActive: 84 },
  bureau: { score: 690, hardInquiriesCount: 1 },
  alt_score: {
    score: 78,
    signals: ['stable_spending', 'no_chargebacks'],
  },
};

// FullState requires bureau.history; selectInput strips it but the upstream
// state has it. We add it here only so the type aligns.
const baseState = {
  ...baseInput,
  bureau: { ...baseInput.bureau, history: [{ at: 0, source: 'test' }] },
};

function makeChunk(ruleId: string, score: number): RetrievedChunk {
  return {
    chunk: {
      ruleId,
      category: ruleId.split('-')[0] as 'MIC' | 'GAR' | 'EXC' | 'SCO',
      title: `Title for ${ruleId}`,
      condicion: 'cond',
      accion: 'acc',
      justificacion: 'just',
      tags: ['t'],
      fullText: `## Regla ${ruleId}\n\nFull text`,
    },
    score,
  };
}

const mockRetrieve = vi.fn();
const mockRerank = vi.fn();
const mockGenerate = vi.fn();

const mockRetriever: RAGRetriever = {
  retrieve: mockRetrieve,
  rerank: mockRerank,
};
const mockLlm: LlmClient = { generate: mockGenerate };

beforeEach(() => {
  __resetForTesting();
  __setDepsForTesting({ retriever: mockRetriever, llm: mockLlm });
  mockRetrieve.mockReset();
  mockRerank.mockReset();
  mockGenerate.mockReset();
});

describe('policyAgent — selectInput', () => {
  it('extracts the relevant slice of FullState including upstream contributions', () => {
    const input = policyAgent.selectInput(baseState);
    expect(input.cedula).toBe('0102030405');
    expect(input.ingresos).toBe(1500);
    expect(input.identity?.name).toBe('Maria Lopez');
    expect(input.bureau?.score).toBe(690);
    expect(input.alt_score?.score).toBe(78);
  });

  it('handles missing upstream contributions gracefully', () => {
    const partial = {
      cedula: '0102030405',
      ingresos: 1500,
      monto: 3000,
      plazo: 24,
    };
    const input = policyAgent.selectInput(partial);
    expect(input.identity).toBeUndefined();
    expect(input.income).toBeUndefined();
    expect(input.bureau).toBeUndefined();
    expect(input.alt_score).toBeUndefined();
  });
});

describe('buildRetrievalQuery', () => {
  it('produces a natural-language query from the input slice', () => {
    const q = buildRetrievalQuery(baseInput);
    expect(q).toContain('Banco Pichincha');
    expect(q).toContain('1450');
    expect(q).toContain('690');
    expect(q).toContain('78');
    expect(q).toContain('3000');
    expect(q).toContain('24');
  });

  it('omits missing fields gracefully', () => {
    const partial = {
      cedula: '0102030405',
      ingresos: 1500,
      monto: 3000,
      plazo: 24,
    };
    const q = buildRetrievalQuery(partial);
    expect(q).toContain('1500');
    expect(q).toContain('3000');
    // No upstream data should not break query construction
    expect(q.length).toBeGreaterThan(0);
  });
});

describe('policyAgent — happy path', () => {
  it('retrieves, reranks, calls LLM, and returns parsed output', async () => {
    const retrieved = [
      makeChunk('MIC-003', 0.9),
      makeChunk('MIC-005', 0.85),
      makeChunk('GAR-001', 0.7),
      makeChunk('SCO-001', 0.6),
      makeChunk('EXC-002', 0.5),
    ];
    mockRetrieve.mockResolvedValue(retrieved);
    mockRerank.mockResolvedValue(retrieved);
    mockGenerate.mockResolvedValue({
      text: JSON.stringify({
        applies: ['MIC-003'],
        notes: 'Maria califica para microcredito estandar por afiliacion IESS y antiguedad.',
      }),
      modelRequested: 'claude-sonnet-4-6',
      modelActual: 'claude-sonnet-4-6',
      degraded: false,
      usage: { inputTokens: 500, outputTokens: 80 },
    });

    const tracer = new RecordingTracer();
    const result = await policyAgent.execute(baseInput, { tracer });

    expect(result.applies).toEqual(['MIC-003']);
    expect(result.notes).toContain('Maria');

    expect(mockRetrieve).toHaveBeenCalledOnce();
    expect(mockRetrieve.mock.calls[0][1]).toBe(5); // K=5
    expect(mockRerank).toHaveBeenCalledOnce();
    expect(mockGenerate).toHaveBeenCalledOnce();

    // System prompt + user message construction includes the retrieved rules.
    const llmCall = mockGenerate.mock.calls[0][0];
    expect(llmCall.system).toContain('cooperativa');
    expect(llmCall.messages[0].content).toContain('MIC-003');
  });

  it('emits span policy.execute with model and rule count metadata', async () => {
    mockRetrieve.mockResolvedValue([makeChunk('MIC-003', 0.9)]);
    mockRerank.mockResolvedValue([makeChunk('MIC-003', 0.9)]);
    mockGenerate.mockResolvedValue({
      text: JSON.stringify({ applies: ['MIC-003'], notes: 'fits' }),
      modelRequested: 'claude-sonnet-4-6',
      modelActual: 'claude-sonnet-4-6',
      degraded: false,
      usage: { inputTokens: 100, outputTokens: 30 },
    });

    const tracer = new RecordingTracer();
    await policyAgent.execute(baseInput, { tracer });

    const span = tracer.spans.find((s) => s.name === 'policy.execute')!;
    expect(span).toBeDefined();
    expect(span.attributes.agent).toBe('policy');
    expect(span.attributes['llm.model.requested']).toBe('claude-sonnet-4-6');
    expect(span.attributes['llm.model.actual']).toBe('claude-sonnet-4-6');
    expect(span.attributes['llm.degraded']).toBe(false);
    expect(span.attributes['rag.chunks_retrieved']).toBe(1);
    expect(span.attributes['policy.applies_count']).toBe(1);
  });

  it('marks the span as degraded when LLM fell back to Haiku', async () => {
    mockRetrieve.mockResolvedValue([makeChunk('MIC-003', 0.9)]);
    mockRerank.mockResolvedValue([makeChunk('MIC-003', 0.9)]);
    mockGenerate.mockResolvedValue({
      text: JSON.stringify({ applies: [], notes: 'no rules apply' }),
      modelRequested: 'claude-sonnet-4-6',
      modelActual: 'claude-haiku-4-5-20251001',
      degraded: true,
      usage: { inputTokens: 100, outputTokens: 30 },
    });

    const tracer = new RecordingTracer();
    await policyAgent.execute(baseInput, { tracer });

    const span = tracer.spans.find((s) => s.name === 'policy.execute')!;
    expect(span.attributes['llm.degraded']).toBe(true);
    expect(span.attributes['llm.model.actual']).toBe('claude-haiku-4-5-20251001');
  });
});

describe('policyAgent — failure modes', () => {
  it('throws DomainError when LLM returns invalid JSON', async () => {
    mockRetrieve.mockResolvedValue([makeChunk('MIC-003', 0.9)]);
    mockRerank.mockResolvedValue([makeChunk('MIC-003', 0.9)]);
    mockGenerate.mockResolvedValue({
      text: 'not json at all',
      modelRequested: 'claude-sonnet-4-6',
      modelActual: 'claude-sonnet-4-6',
      degraded: false,
      usage: { inputTokens: 100, outputTokens: 30 },
    });

    const tracer = new RecordingTracer();
    await expect(
      policyAgent.execute(baseInput, { tracer }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('throws DomainError when LLM JSON has wrong shape', async () => {
    mockRetrieve.mockResolvedValue([makeChunk('MIC-003', 0.9)]);
    mockRerank.mockResolvedValue([makeChunk('MIC-003', 0.9)]);
    mockGenerate.mockResolvedValue({
      text: JSON.stringify({ applies: 'not-an-array', notes: 'x' }),
      modelRequested: 'claude-sonnet-4-6',
      modelActual: 'claude-sonnet-4-6',
      degraded: false,
      usage: { inputTokens: 100, outputTokens: 30 },
    });

    const tracer = new RecordingTracer();
    await expect(
      policyAgent.execute(baseInput, { tracer }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('propagates OperationalError when retriever fails', async () => {
    mockRetrieve.mockRejectedValue(new OperationalError('embed_500'));

    const tracer = new RecordingTracer();
    await expect(
      policyAgent.execute(baseInput, { tracer }),
    ).rejects.toBeInstanceOf(OperationalError);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('propagates OperationalError when LLM fails after fallback', async () => {
    mockRetrieve.mockResolvedValue([makeChunk('MIC-003', 0.9)]);
    mockRerank.mockResolvedValue([makeChunk('MIC-003', 0.9)]);
    mockGenerate.mockRejectedValue(new OperationalError('anthropic_500'));

    const tracer = new RecordingTracer();
    await expect(
      policyAgent.execute(baseInput, { tracer }),
    ).rejects.toBeInstanceOf(OperationalError);
  });
});

describe('policyAgent — schema contracts', () => {
  it('outputSchema accepts empty applies (no rule fits)', () => {
    expect(
      policyAgent.outputSchema.safeParse({ applies: [], notes: 'no rules' })
        .success,
    ).toBe(true);
  });

  it('outputSchema rejects rule ids with wrong category', () => {
    expect(
      policyAgent.outputSchema.safeParse({
        applies: ['XYZ-001'],
        notes: 'x',
      }).success,
    ).toBe(false);
  });

  it('outputSchema rejects empty notes', () => {
    expect(
      policyAgent.outputSchema.safeParse({ applies: [], notes: '' }).success,
    ).toBe(false);
  });
});
