import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getAltScoreClient,
  setMode,
  getBreakerSnapshot,
  __resetForTesting,
} from './index';
import { personas } from '@/services/mocks/_dataset/personas';
import { OperationalError, DomainError } from '@/lib/errors';

beforeEach(() => {
  __resetForTesting();
});

describe('ScoreAlternativoMock — happy mode', () => {
  it('returns altScore for a persona with synthetic footprint', async () => {
    const target = personas.find((p) => p.altScore !== undefined)!;
    const client = getAltScoreClient();

    const report = await client.getAltScore(target.cedula);

    expect(report.score).toBe(target.altScore!.score);
    expect(report.signals).toEqual(target.altScore!.signals);
  });

  it('throws DomainError("sin_data") for a persona without altScore', async () => {
    const target = personas.find((p) => p.altScore === undefined)!;
    const client = getAltScoreClient();

    await expect(client.getAltScore(target.cedula)).rejects.toMatchObject({
      name: 'DomainError',
      message: 'sin_data',
    });
  });
});

describe('ScoreAlternativoMock — error_500 mode', () => {
  it('throws OperationalError on every call', async () => {
    setMode('error_500');
    const target = personas.find((p) => p.altScore !== undefined)!;

    await expect(
      getAltScoreClient().getAltScore(target.cedula),
    ).rejects.toBeInstanceOf(OperationalError);
  });

  it('opens the breaker after 5 consecutive errors', async () => {
    setMode('error_500');
    const target = personas.find((p) => p.altScore !== undefined)!;
    const client = getAltScoreClient();

    for (let i = 0; i < 5; i++) {
      await expect(
        client.getAltScore(target.cedula),
      ).rejects.toBeInstanceOf(OperationalError);
    }
    expect(getBreakerSnapshot().state).toBe('OPEN');
  });
});

describe('ScoreAlternativoMock — sin_data forced mode', () => {
  it('throws DomainError for any cedula, including those with altScore', async () => {
    setMode('sin_data');
    const target = personas.find((p) => p.altScore !== undefined)!;

    await expect(
      getAltScoreClient().getAltScore(target.cedula),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('does NOT open the breaker', async () => {
    setMode('sin_data');
    const target = personas.find((p) => p.altScore !== undefined)!;
    const client = getAltScoreClient();

    for (let i = 0; i < 10; i++) {
      await expect(client.getAltScore(target.cedula)).rejects.toBeInstanceOf(
        DomainError,
      );
    }
    expect(getBreakerSnapshot().state).toBe('CLOSED');
  });
});

describe('ScoreAlternativoMock — slow mode under timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after 2s slow latency (under 5s breaker timeout)', async () => {
    setMode('slow');
    const target = personas.find((p) => p.altScore !== undefined)!;

    const promise = getAltScoreClient().getAltScore(target.cedula);
    vi.advanceTimersByTime(2_500);

    await expect(promise).resolves.toMatchObject({
      score: target.altScore!.score,
    });
  });
});
