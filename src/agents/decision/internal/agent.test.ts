import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  decisionAgent,
  __setLlmForTesting,
  __resetForTesting,
  __setPolicyChunkLookupForTesting,
} from './agent';
import { RecordingTracer } from '@/lib/tracer';
import type { LlmClient } from '@/lib/llm';
import type { DecisionInput } from './types';

const ALIVE_AFILIADO: DecisionInput = {
  cedula: '0102030405',
  ingresos: 1500,
  monto: 3000,
  plazo: 24,
  identity: { name: 'Maria Lopez Vargas', birthDate: '1985-04-12', valid: true },
  income: { employer: 'Banco Pichincha', salary: 1450, monthsActive: 84 },
  bureau: { score: 720, hardInquiriesCount: 1 },
  alt_score: { score: 78, signals: ['stable_spending', 'no_chargebacks'] },
  policy: {
    applies: ['MIC-003', 'MIC-004'],
    notes: 'Maria califica para microcredito estandar.',
  },
};

const FALLECIDO: DecisionInput = {
  ...ALIVE_AFILIADO,
  identity: { ...ALIVE_AFILIADO.identity!, valid: false },
};

const SOBREENDEUDADO: DecisionInput = {
  ...ALIVE_AFILIADO,
  monto: 10000,
  plazo: 12, // cuota proyectada 833, salary 1450 → DTI 0.575 > 0.5
};

const MENOR: DecisionInput = {
  ...ALIVE_AFILIADO,
  identity: { name: 'Joven X', birthDate: '2011-01-15', valid: true },
};

const mockGenerate = vi.fn();
const mockLlm: LlmClient = { generate: mockGenerate };

beforeEach(() => {
  __resetForTesting();
  __setLlmForTesting(mockLlm);
  __setPolicyChunkLookupForTesting(
    new Map([
      [
        'MIC-003',
        {
          ruleId: 'MIC-003',
          fullText: '## Regla MIC-003 — Microcredito estandar',
        },
      ],
      [
        'MIC-004',
        {
          ruleId: 'MIC-004',
          fullText: '## Regla MIC-004 — Microcredito ampliado',
        },
      ],
    ]),
  );
  mockGenerate.mockReset();
});

function buildOkLlm(reason: string, citedRules: string[] = []) {
  return {
    text: JSON.stringify({ reason, citedRules }),
    modelRequested: 'claude-sonnet-4-6',
    modelActual: 'claude-sonnet-4-6',
    degraded: false,
    usage: { inputTokens: 800, outputTokens: 100 },
  };
}

function buildDegradedLlm(reason: string, citedRules: string[] = []) {
  return {
    text: JSON.stringify({ reason, citedRules }),
    modelRequested: 'claude-sonnet-4-6',
    modelActual: 'claude-haiku-4-5-20251001',
    degraded: true,
    usage: { inputTokens: 800, outputTokens: 100 },
  };
}

describe('decisionAgent — selectInput', () => {
  it('extracts the relevant slice of FullState (incluyendo policy)', () => {
    const result = decisionAgent.selectInput({
      cedula: '0102030405',
      ingresos: 1500,
      monto: 3000,
      plazo: 24,
      identity: { name: 'X', birthDate: '1985-04-12', valid: true },
      income: { employer: 'X', salary: 1450, monthsActive: 84 },
      bureau: {
        score: 720,
        hardInquiriesCount: 1,
        history: [{ at: 0, source: 'cooperativa-demo' }],
      },
      alt_score: { score: 78, signals: ['x'] },
      policy: { applies: ['MIC-003'], notes: 'note' },
    });
    expect(result.cedula).toBe('0102030405');
    expect(result.bureau?.score).toBe(720);
    expect(result.policy?.applies).toEqual(['MIC-003']);
  });
});

describe('decisionAgent — hard reject paths bypass LLM', () => {
  it('persona fallecida → REJECTED hard sin llamar LLM', async () => {
    const tracer = new RecordingTracer();
    const result = await decisionAgent.execute(FALLECIDO, { tracer });

    expect(result.decision).toBe('REJECTED');
    expect(result.decisionType).toBe('hard_reject');
    if (result.decisionType === 'hard_reject') {
      expect(result.confidence).toBe(1);
      expect(result.llmBypassed).toBe(true);
      expect(result.citedRules).toEqual(['EXC-001']);
      expect(result.triggeredBy.source).toBe('registro_civil');
    }
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('menor de edad → REJECTED hard sin llamar LLM', async () => {
    const tracer = new RecordingTracer();
    const result = await decisionAgent.execute(MENOR, { tracer });

    expect(result.decision).toBe('REJECTED');
    if (result.decisionType === 'hard_reject') {
      expect(result.citedRules).toEqual(['EXC-002']);
    }
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('sobreendeudamiento → REJECTED hard sin llamar LLM', async () => {
    const tracer = new RecordingTracer();
    const result = await decisionAgent.execute(SOBREENDEUDADO, { tracer });

    expect(result.decision).toBe('REJECTED');
    if (result.decisionType === 'hard_reject') {
      expect(result.citedRules).toEqual(['EXC-003']);
    }
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});

describe('decisionAgent — llm_decision happy path', () => {
  it('Maria APPROVED → llama LLM, parsea reason + citedRules', async () => {
    mockGenerate.mockResolvedValue(
      buildOkLlm(
        'Perfil solido: afiliacion IESS de 84 meses con sueldo 1450, score 720, alt-score 78. Aprobacion con condiciones estandar de MIC-003.',
        ['MIC-003'],
      ),
    );

    const tracer = new RecordingTracer();
    const result = await decisionAgent.execute(ALIVE_AFILIADO, { tracer });

    expect(result.decision).toBe('APPROVED');
    expect(result.decisionType).toBe('llm_decision');
    if (result.decisionType === 'llm_decision') {
      expect(result.confidence).toBeGreaterThan(0.85);
      expect(result.degraded).toBe(false);
      expect(result.reason).toContain('MIC-003');
      expect(result.citedRules).toEqual(['MIC-003']);
      expect(result.breakdown).toHaveLength(6);
    }

    expect(mockGenerate).toHaveBeenCalledOnce();
  });

  it('LLM call recibe system prompt + user message con perfil + breakdown + reglas', async () => {
    mockGenerate.mockResolvedValue(buildOkLlm('Bien.', []));

    const tracer = new RecordingTracer();
    await decisionAgent.execute(ALIVE_AFILIADO, { tracer });

    const call = mockGenerate.mock.calls[0][0];
    expect(call.system).toContain('evaluador de credito');
    expect(call.system).toContain('MANEJO DE TENSION');
    expect(call.temperature).toBe(0.3);
    expect(call.maxTokens).toBe(200);

    const userMsg = call.messages[0].content;
    expect(userMsg).toContain('Maria Lopez Vargas');
    expect(userMsg).toContain('confidence:');
    expect(userMsg).toContain('decision tentativa: APPROVED');
    expect(userMsg).toContain('bucket: A');
    expect(userMsg).toContain('MIC-003');
  });
});

describe('decisionAgent — llm_decision validation', () => {
  it('citedRules ⊄ policy.applies → DomainError (cita regla desconocida)', async () => {
    mockGenerate.mockResolvedValue(
      buildOkLlm('Perfil bien.', ['SCO-099']), // SCO-099 NO esta en policy.applies
    );

    const tracer = new RecordingTracer();
    await expect(
      decisionAgent.execute(ALIVE_AFILIADO, { tracer }),
    ).rejects.toThrow(/citedRules/i);
  });

  it('reason > 500 chars → fallback a canned + degraded:true', async () => {
    const longReason = 'a'.repeat(600);
    mockGenerate.mockResolvedValue(buildOkLlm(longReason, []));

    const tracer = new RecordingTracer();
    const result = await decisionAgent.execute(ALIVE_AFILIADO, { tracer });

    expect(result.decision).toBe('APPROVED');
    if (result.decisionType === 'llm_decision') {
      expect(result.degraded).toBe(true);
      expect(result.reason).toContain('modo degradado');
    }
  });

  it('JSON invalido del LLM → fallback a canned + degraded:true', async () => {
    mockGenerate.mockResolvedValue({
      text: 'no json at all',
      modelRequested: 'claude-sonnet-4-6',
      modelActual: 'claude-sonnet-4-6',
      degraded: false,
      usage: { inputTokens: 800, outputTokens: 100 },
    });

    const tracer = new RecordingTracer();
    const result = await decisionAgent.execute(ALIVE_AFILIADO, { tracer });

    expect(result.decision).toBe('APPROVED');
    if (result.decisionType === 'llm_decision') {
      expect(result.degraded).toBe(true);
    }
  });
});

describe('decisionAgent — degraded propagation', () => {
  it('LLM degraded:true se propaga al output del agent', async () => {
    mockGenerate.mockResolvedValue(buildDegradedLlm('Aprobacion en Haiku.', []));

    const tracer = new RecordingTracer();
    const result = await decisionAgent.execute(ALIVE_AFILIADO, { tracer });

    if (result.decisionType === 'llm_decision') {
      expect(result.degraded).toBe(true);
      expect(result.modelActual).toBe('claude-haiku-4-5-20251001');
    }
  });
});

describe('decisionAgent — observability', () => {
  it('span decision.execute con metadata completa para llm_decision', async () => {
    mockGenerate.mockResolvedValue(buildOkLlm('OK', ['MIC-003']));

    const tracer = new RecordingTracer();
    await decisionAgent.execute(ALIVE_AFILIADO, { tracer });

    const span = tracer.spans.find((s) => s.name === 'decision.execute')!;
    expect(span).toBeDefined();
    expect(span.attributes['decision.type']).toBe('llm_decision');
    expect(span.attributes['decision.value']).toBe('APPROVED');
    expect(span.attributes['confidence']).toBeGreaterThan(0.85);
    expect(span.attributes['llm.degraded']).toBe(false);
    expect(span.attributes['llm.tokens.input']).toBe(800);
    expect(span.attributes['llm.tokens.output']).toBe(100);
  });

  it('span decision.execute con metadata para hard_reject (sin LLM)', async () => {
    const tracer = new RecordingTracer();
    await decisionAgent.execute(FALLECIDO, { tracer });

    const span = tracer.spans.find((s) => s.name === 'decision.execute')!;
    expect(span.attributes['decision.type']).toBe('hard_reject');
    expect(span.attributes['decision.value']).toBe('REJECTED');
    expect(span.attributes['confidence']).toBe(1);
    expect(span.attributes['cited_rule']).toBe('EXC-001');
  });
});

describe('decisionAgent — onLlmCall callback', () => {
  it('publica usage al callback cuando llama LLM', async () => {
    mockGenerate.mockResolvedValue(buildOkLlm('OK', []));
    const onLlmCall = vi.fn();

    const tracer = new RecordingTracer();
    await decisionAgent.execute(ALIVE_AFILIADO, { tracer, onLlmCall });

    expect(onLlmCall).toHaveBeenCalledOnce();
    expect(onLlmCall).toHaveBeenCalledWith('decision', {
      inputTokens: 800,
      outputTokens: 100,
    });
  });

  it('NO publica al callback cuando hard_reject (no LLM call)', async () => {
    const onLlmCall = vi.fn();
    const tracer = new RecordingTracer();

    await decisionAgent.execute(FALLECIDO, { tracer, onLlmCall });
    expect(onLlmCall).not.toHaveBeenCalled();
  });
});
