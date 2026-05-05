import { describe, it, expect, beforeEach } from 'vitest';
import { altScoreAgent } from '@/agents/alt_score';
import {
  __resetForTesting,
  setMode,
} from '@/services/mocks/score-alternativo';
import { personas } from '@/services/mocks/_dataset/personas';
import { RecordingTracer } from '@/lib/tracer';
import { OperationalError, DomainError } from '@/lib/errors';

beforeEach(() => {
  __resetForTesting();
});

const baseState = {
  ingresos: 1500,
  monto: 3000,
  plazo: 24,
};

describe('altScoreAgent — happy path', () => {
  it('selects cedula and returns score + signals', async () => {
    const target = personas.find((p) => p.altScore !== undefined)!;
    const tracer = new RecordingTracer();

    const input = altScoreAgent.selectInput({
      ...baseState,
      cedula: target.cedula,
    });
    expect(input).toEqual({ cedula: target.cedula });

    const output = await altScoreAgent.execute(input, { tracer });

    expect(output.score).toBe(target.altScore!.score);
    expect(output.signals).toEqual(target.altScore!.signals);
  });
});

describe('altScoreAgent — error paths', () => {
  it('propagates DomainError when persona has no altScore', async () => {
    const target = personas.find((p) => p.altScore === undefined)!;
    const tracer = new RecordingTracer();

    await expect(
      altScoreAgent.execute({ cedula: target.cedula }, { tracer }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('propagates OperationalError when mock is in error_500 mode', async () => {
    setMode('error_500');
    const target = personas.find((p) => p.altScore !== undefined)!;
    const tracer = new RecordingTracer();

    await expect(
      altScoreAgent.execute({ cedula: target.cedula }, { tracer }),
    ).rejects.toBeInstanceOf(OperationalError);
  });
});

describe('altScoreAgent — observability', () => {
  it('emits span alt_score.execute with breaker.state attribute', async () => {
    const tracer = new RecordingTracer();
    const target = personas.find((p) => p.altScore !== undefined)!;

    await altScoreAgent.execute({ cedula: target.cedula }, { tracer });

    const span = tracer.spans.find((s) => s.name === 'alt_score.execute')!;
    expect(span.attributes.agent).toBe('alt_score');
    expect(span.attributes['breaker.state']).toBe('CLOSED');
  });
});

describe('altScoreAgent — schema contracts', () => {
  it('outputSchema accepts score 0-100 with non-empty signals', () => {
    expect(
      altScoreAgent.outputSchema.safeParse({
        score: 75,
        signals: ['stable_spending'],
      }).success,
    ).toBe(true);
  });

  it('outputSchema rejects score > 100', () => {
    expect(
      altScoreAgent.outputSchema.safeParse({
        score: 150,
        signals: ['x'],
      }).success,
    ).toBe(false);
  });

  it('outputSchema rejects empty signals array', () => {
    expect(
      altScoreAgent.outputSchema.safeParse({
        score: 50,
        signals: [],
      }).success,
    ).toBe(false);
  });
});
