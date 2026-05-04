import { createBreaker, type Breaker } from '@/lib/circuit-breaker';
import { OperationalError, DomainError } from '@/lib/errors';
import { personas, type Persona } from '@/services/mocks/_dataset/personas';

export type RegistroCivilMode = 'happy' | 'slow' | 'error_500' | 'not_found';

export interface PersonRecord {
  name: string;
  birthDate: string;
  deathDate?: string;
}

const breakerConfig = {
  failureThreshold: 5,
  cooldownMs: 60_000,
  halfOpenMaxCalls: 1,
  timeoutMs: 10_000,
};

let mode: RegistroCivilMode = 'happy';
let breaker: Breaker = createBreaker(breakerConfig);

const SLOW_LATENCY_MS = 3_000;

export function setMode(next: RegistroCivilMode): void {
  mode = next;
}

export function getMode(): RegistroCivilMode {
  return mode;
}

export function getBreakerSnapshot() {
  return breaker.getState();
}

export function __resetForTesting(): void {
  mode = 'happy';
  breaker = createBreaker(breakerConfig);
}

async function lookupPerson(cedula: string): Promise<PersonRecord> {
  if (mode === 'error_500') {
    throw new OperationalError('error_500');
  }

  if (mode === 'not_found') {
    throw new DomainError('not_found');
  }

  if (mode === 'slow') {
    await new Promise<void>((resolve) =>
      setTimeout(resolve, SLOW_LATENCY_MS),
    );
  }

  const persona: Persona | undefined = personas.find((p) => p.cedula === cedula);
  if (!persona) {
    throw new DomainError('not_found');
  }

  return {
    name: persona.name,
    birthDate: persona.birthDate,
    ...(persona.deathDate ? { deathDate: persona.deathDate } : {}),
  };
}

export function getRegistroCivilClient() {
  return {
    getPerson: (cedula: string): Promise<PersonRecord> =>
      breaker.call(() => lookupPerson(cedula)),
  };
}
