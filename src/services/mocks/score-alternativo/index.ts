import { createBreaker, type Breaker } from '@/lib/circuit-breaker';
import { OperationalError, DomainError } from '@/lib/errors';
import {
  personas,
  type AltScore,
} from '@/services/mocks/_dataset/personas';

export type AltScoreMode = 'happy' | 'slow' | 'error_500' | 'sin_data';

const breakerConfig = {
  failureThreshold: 5,
  cooldownMs: 60_000,
  halfOpenMaxCalls: 1,
  timeoutMs: 5_000,
};

const SLOW_LATENCY_MS = 2_000;

let mode: AltScoreMode = 'happy';
let breaker: Breaker = createBreaker(breakerConfig);

export function setMode(next: AltScoreMode): void {
  mode = next;
}

export function getMode(): AltScoreMode {
  return mode;
}

export function getBreakerSnapshot() {
  return breaker.getState();
}

export function __resetForTesting(): void {
  mode = 'happy';
  breaker = createBreaker(breakerConfig);
}

async function lookupAltScore(cedula: string): Promise<AltScore> {
  if (mode === 'error_500') {
    throw new OperationalError('error_500');
  }

  if (mode === 'sin_data') {
    throw new DomainError('sin_data');
  }

  if (mode === 'slow') {
    await new Promise<void>((r) => setTimeout(r, SLOW_LATENCY_MS));
  }

  const persona = personas.find((p) => p.cedula === cedula);
  if (!persona || persona.altScore === undefined) {
    throw new DomainError('sin_data');
  }

  return { ...persona.altScore, signals: [...persona.altScore.signals] };
}

export function getAltScoreClient() {
  return {
    getAltScore: (cedula: string): Promise<AltScore> =>
      breaker.call(() => lookupAltScore(cedula)),
  };
}
