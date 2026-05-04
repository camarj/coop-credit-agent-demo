import { createBreaker, type Breaker } from '@/lib/circuit-breaker';
import { OperationalError } from '@/lib/errors';
import { personas } from '@/services/mocks/_dataset/personas';
import { HARD_INQUIRY_PENALTY, SCORE_FLOOR } from './config';

export type EquifaxMode =
  | 'happy'
  | 'slow'
  | 'error_429'
  | 'score_bajo'
  | 'score_alto';

export interface HardInquiry {
  at: number; // epoch ms
  source: 'cooperativa-demo';
}

export interface BureauReport {
  score: number;
  history: HardInquiry[];
  hardInquiriesCount: number;
}

const breakerConfig = {
  failureThreshold: 5,
  cooldownMs: 60_000,
  halfOpenMaxCalls: 1,
  timeoutMs: 10_000,
};

const SLOW_LATENCY_MS = 5_000;
const FORCED_LOW_SCORE = 420;
const FORCED_HIGH_SCORE = 780;

let mode: EquifaxMode = 'happy';
let breaker: Breaker = createBreaker(breakerConfig);
const inquiriesByCedula = new Map<string, HardInquiry[]>();

export function setMode(next: EquifaxMode): void {
  mode = next;
}

export function getMode(): EquifaxMode {
  return mode;
}

export function getBreakerSnapshot() {
  return breaker.getState();
}

export function __resetForTesting(): void {
  mode = 'happy';
  breaker = createBreaker(breakerConfig);
  inquiriesByCedula.clear();
}

function computeScore(baseScore: number, count: number): number {
  return Math.max(SCORE_FLOOR, baseScore - count * HARD_INQUIRY_PENALTY);
}

async function performHardPull(cedula: string): Promise<BureauReport> {
  if (mode === 'error_429') {
    throw new OperationalError('error_429');
  }

  if (mode === 'slow') {
    await new Promise<void>((r) => setTimeout(r, SLOW_LATENCY_MS));
  }

  // Side effect: append a new inquiry. ALWAYS happens after operational checks
  // pass — we do not record inquiries that never reached the bureau.
  const existing = inquiriesByCedula.get(cedula) ?? [];
  const next = [...existing, { at: Date.now(), source: 'cooperativa-demo' as const }];
  inquiriesByCedula.set(cedula, next);

  const persona = personas.find((p) => p.cedula === cedula);
  const baseScore = persona?.equifaxBaseScore ?? 600;

  let score: number;
  if (mode === 'score_bajo') score = FORCED_LOW_SCORE;
  else if (mode === 'score_alto') score = FORCED_HIGH_SCORE;
  else score = computeScore(baseScore, next.length);

  return {
    score,
    history: next,
    hardInquiriesCount: next.length,
  };
}

export function getEquifaxClient() {
  return {
    requestHardPull: (cedula: string): Promise<BureauReport> =>
      breaker.call(() => performHardPull(cedula)),

    /**
     * Reverses the last hard inquiry recorded for this cedula. Used by
     * `bureauAgent.compensate()` during saga walk-back. Idempotent on empty.
     * Does NOT go through the breaker — compensation must be reliable even
     * when the breaker is OPEN.
     */
    removeLastHardInquiry: async (cedula: string): Promise<void> => {
      const existing = inquiriesByCedula.get(cedula);
      if (!existing || existing.length === 0) return;
      inquiriesByCedula.set(cedula, existing.slice(0, -1));
    },
  };
}
