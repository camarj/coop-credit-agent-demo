import type {
  DecisionInput,
  ConfidenceResult,
  SignalContribution,
} from './types';

/**
 * APPROVAL_THRESHOLD is the initial value of the calibration loop, NOT a
 * fixed constant. Configurable from day 1 via env var so slice 9 can move
 * it based on observed `%REVIEW`, oficiales' approval/rejection rates, etc.
 * See ADR-0008 sections 6 and 7.
 */
export const APPROVAL_THRESHOLD = parseFloat(
  process.env.CONFIDENCE_THRESHOLD ?? '0.70',
);

const WEIGHTS = {
  bureau_score: 0.25,
  alt_score: 0.25,
  iess_affiliation: 0.15,
  iess_tenure: 0.15,
  hard_inquiries: 0.1,
  age_band: 0.1,
} as const;

const NEUTRAL_DEFAULT = 0.5;

/**
 * computeConfidence is a PURE function — no IO, no LLM, no DB. Testable
 * in isolation with hardcoded inputs. The output is a number in `[0, 1]`
 * plus a per-signal breakdown that is persisted as audit trail in the
 * decisionAgent output (literal copy — see ADR-0008 section 4 ↔ 5).
 *
 * Default `0.5` (neutral) when a signal is unavailable. This is a known
 * limitation documented as deuda slice 9+: if e.g. bureau falls for all
 * autonomos, confidence rises artificially. Refactor to normalization
 * over available signals when production data shows the bias. See
 * ADR-0008 section 5 caveat + tabla disparadores.
 */
export function computeConfidence(input: DecisionInput): ConfidenceResult {
  const breakdown: SignalContribution[] = [
    buildSignal('bureau_score', WEIGHTS.bureau_score, input.bureau?.score),
    buildSignal('alt_score', WEIGHTS.alt_score, input.alt_score?.score),
    buildIessAffiliation(input),
    buildIessTenure(input),
    buildHardInquiries(input),
    buildAgeBand(input),
  ];

  // Override the generic builder for bureau_score and alt_score with their
  // specific contribution functions (the generic builder does linear mapping
  // to a default range; bureau and alt have specific ranges).
  breakdown[0] = applyContrib(
    breakdown[0],
    contribBureauScore(input.bureau?.score),
  );
  breakdown[1] = applyContrib(breakdown[1], contribAltScore(input.alt_score?.score));

  const weightedSum = breakdown.reduce((s, b) => s + b.weighted, 0);
  return { value: clamp01(weightedSum), breakdown };
}

// ---- Signal builders ----------------------------------------------------

function buildSignal(
  signal: string,
  weight: number,
  rawValue: number | undefined,
): SignalContribution {
  // Placeholder — overwritten by applyContrib for bureau/alt_score
  const contribution = rawValue === undefined ? NEUTRAL_DEFAULT : 0;
  return {
    signal,
    weight,
    rawValue: rawValue ?? null,
    contribution,
    weighted: weight * contribution,
  };
}

function applyContrib(
  base: SignalContribution,
  contribution: number,
): SignalContribution {
  return { ...base, contribution, weighted: base.weight * contribution };
}

function buildIessAffiliation(input: DecisionInput): SignalContribution {
  const isAffiliated = input.income !== undefined;
  // Autonomo gets 0.4 (not 0) because MIC-001/002 explicitly accept autonomos
  // — the rule is "no IESS = different product", not "no IESS = penalty 100%".
  const contribution = isAffiliated ? 1.0 : 0.4;
  return {
    signal: 'iess_affiliation',
    weight: WEIGHTS.iess_affiliation,
    rawValue: isAffiliated ? 1 : null,
    contribution,
    weighted: WEIGHTS.iess_affiliation * contribution,
  };
}

function buildIessTenure(input: DecisionInput): SignalContribution {
  const tenure = input.income?.monthsActive;
  // Autonomo: tenure does not apply at all — contribution 0 (not neutral).
  // Otherwise linear [12, 84] months → [0, 1].
  let contribution: number;
  if (tenure === undefined) {
    contribution = 0;
  } else {
    contribution = clamp01((tenure - 12) / (84 - 12));
  }
  return {
    signal: 'iess_tenure',
    weight: WEIGHTS.iess_tenure,
    rawValue: tenure ?? null,
    contribution,
    weighted: WEIGHTS.iess_tenure * contribution,
  };
}

function buildHardInquiries(input: DecisionInput): SignalContribution {
  const count = input.bureau?.hardInquiriesCount;
  // bureau undefined → neutral 0.5
  // count >= 3 → 0 (espejo MIC-005), 2 → 0.7, 1 → 0.85, 0 → 1.0
  let contribution: number;
  if (count === undefined) {
    contribution = NEUTRAL_DEFAULT;
  } else if (count >= 3) {
    contribution = 0;
  } else if (count === 2) {
    contribution = 0.7;
  } else if (count === 1) {
    contribution = 0.85;
  } else {
    contribution = 1.0;
  }
  return {
    signal: 'hard_inquiries',
    weight: WEIGHTS.hard_inquiries,
    rawValue: count ?? null,
    contribution,
    weighted: WEIGHTS.hard_inquiries * contribution,
  };
}

function buildAgeBand(input: DecisionInput): SignalContribution {
  const birthDate = input.identity?.birthDate;
  // identity undefined → neutral 0.5
  // edad <= 75 → 1.0
  // edad in [75, 85] → linear [1, 0]
  // edad >= 85 → 0
  let contribution: number;
  let rawValue: number | null;
  if (birthDate === undefined) {
    contribution = NEUTRAL_DEFAULT;
    rawValue = null;
  } else {
    const age = computeAge(birthDate);
    rawValue = age;
    if (age <= 75) {
      contribution = 1.0;
    } else if (age >= 85) {
      contribution = 0;
    } else {
      contribution = clamp01(1 - (age - 75) / 10);
    }
  }
  return {
    signal: 'age_band',
    weight: WEIGHTS.age_band,
    rawValue,
    contribution,
    weighted: WEIGHTS.age_band * contribution,
  };
}

// ---- Per-signal contribution functions ----------------------------------

function contribBureauScore(score: number | undefined): number {
  // bureau undefined → neutral 0.5 (deuda slice 9+ — ver ADR-0008 sec 5)
  if (score === undefined) return NEUTRAL_DEFAULT;
  // linear [500, 720] → [0, 1], clamped
  return clamp01((score - 500) / (720 - 500));
}

function contribAltScore(score: number | undefined): number {
  // alt_score undefined → neutral 0.5
  if (score === undefined) return NEUTRAL_DEFAULT;
  // linear [30, 80] → [0, 1], clamped
  return clamp01((score - 30) / (80 - 30));
}

// ---- Helpers -------------------------------------------------------------

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Computes age in full years from ISO birthDate (YYYY-MM-DD) at the current
 * server time. Pure function over `Date.now()`.
 */
export function computeAge(birthDate: string, now: Date = new Date()): number {
  const birth = new Date(birthDate);
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
}
