import { createBreaker, type Breaker } from '@/lib/circuit-breaker';
import { OperationalError, DomainError } from '@/lib/errors';
import {
  personas,
  type Employment,
} from '@/services/mocks/_dataset/personas';

export type IessMode = 'happy' | 'slow' | 'error_503' | 'sin_afiliacion';

/**
 * Per-mock breaker config. IESS is notoriamente lento and erratic in
 * production, so thresholds and timeout are more tolerant than the
 * RegistroCivil defaults — see ADR-0003.
 */
const breakerConfig = {
  failureThreshold: 7,
  cooldownMs: 90_000,
  halfOpenMaxCalls: 1,
  timeoutMs: 15_000,
};

const SLOW_LATENCY_MS = 8_000;

let mode: IessMode = 'happy';
let breaker: Breaker = createBreaker(breakerConfig);

export function setMode(next: IessMode): void {
  mode = next;
}

export function getMode(): IessMode {
  return mode;
}

export function getBreakerSnapshot() {
  return breaker.getState();
}

export function __resetForTesting(): void {
  mode = 'happy';
  breaker = createBreaker(breakerConfig);
}

async function lookupEmployment(cedula: string): Promise<Employment> {
  if (mode === 'error_503') {
    throw new OperationalError('error_503');
  }

  if (mode === 'sin_afiliacion') {
    throw new DomainError('sin_afiliacion');
  }

  if (mode === 'slow') {
    await new Promise<void>((resolve) =>
      setTimeout(resolve, SLOW_LATENCY_MS),
    );
  }

  const persona = personas.find((p) => p.cedula === cedula);
  if (!persona || persona.employment === undefined) {
    throw new DomainError('sin_afiliacion');
  }

  return { ...persona.employment };
}

export function getIessClient() {
  return {
    getEmployment: (cedula: string): Promise<Employment> =>
      breaker.call(() => lookupEmployment(cedula)),
  };
}
