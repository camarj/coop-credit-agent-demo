import { describe, it, expect } from 'vitest';
import { computeConfidence, APPROVAL_THRESHOLD } from './confidence';
import type { DecisionInput } from './types';

// Maria Lopez Vargas — perfil canonico afiliado IESS solido
const MARIA: DecisionInput = {
  cedula: '0102030405',
  ingresos: 1500,
  monto: 3000,
  plazo: 24,
  identity: {
    name: 'Maria Lopez Vargas',
    birthDate: '1985-04-12',
    valid: true,
  },
  income: { employer: 'Banco Pichincha', salary: 1450, monthsActive: 84 },
  bureau: { score: 720, hardInquiriesCount: 1 },
  alt_score: {
    score: 78,
    signals: ['stable_spending', 'no_chargebacks', 'long_account_history'],
  },
};

// Bryan Calderon Sevilla — autonomo sin RUC, perfil REVIEW esperado
const BRYAN: DecisionInput = {
  cedula: '0102030406',
  ingresos: 800,
  monto: 1500,
  plazo: 18,
  identity: {
    name: 'Bryan Calderon Sevilla',
    birthDate: '1992-06-20',
    valid: true,
  },
  income: undefined, // autonomo
  bureau: { score: 580, hardInquiriesCount: 0 },
  alt_score: { score: 52, signals: ['regular_income', 'moderate_spending'] },
};

// Perfil minimo — todo undefined excepto intake
const SOLO_INTAKE: DecisionInput = {
  cedula: '0102030407',
  ingresos: 1000,
  monto: 2000,
  plazo: 12,
};

describe('computeConfidence — perfiles canonicos del dataset', () => {
  it('Maria Lopez (afiliada solida) → confidence ALTA y APPROVED', () => {
    const result = computeConfidence(MARIA);
    expect(result.value).toBeGreaterThanOrEqual(APPROVAL_THRESHOLD); // >= 0.70
    expect(result.value).toBeGreaterThan(0.75);
    expect(result.value).toBeLessThanOrEqual(1.0);
  });

  it('Bryan Calderon (autonomo medio) → confidence en bucket REVIEW', () => {
    const result = computeConfidence(BRYAN);
    expect(result.value).toBeGreaterThanOrEqual(0.4);
    expect(result.value).toBeLessThan(APPROVAL_THRESHOLD); // < 0.70 → REVIEW
  });

  it('Solo intake (todas las senales unavailable) → confidence cerca de 0.5 neutral', () => {
    const result = computeConfidence(SOLO_INTAKE);
    expect(result.value).toBeGreaterThanOrEqual(0.3);
    expect(result.value).toBeLessThanOrEqual(0.6);
  });
});

describe('computeConfidence — breakdown shape', () => {
  it('returns 6 signals in fixed order', () => {
    const result = computeConfidence(MARIA);
    expect(result.breakdown).toHaveLength(6);
    expect(result.breakdown.map((b) => b.signal)).toEqual([
      'bureau_score',
      'alt_score',
      'iess_affiliation',
      'iess_tenure',
      'hard_inquiries',
      'age_band',
    ]);
  });

  it('weights sum to 1.00', () => {
    const result = computeConfidence(MARIA);
    const totalWeight = result.breakdown.reduce((s, b) => s + b.weight, 0);
    expect(totalWeight).toBeCloseTo(1.0, 5);
  });

  it('value equals sum of weighted contributions clamped to [0,1]', () => {
    const result = computeConfidence(MARIA);
    const weightedSum = result.breakdown.reduce((s, b) => s + b.weighted, 0);
    expect(result.value).toBeCloseTo(Math.min(1, Math.max(0, weightedSum)), 5);
  });

  it('rawValue is the raw input per signal (null when unavailable)', () => {
    const result = computeConfidence(MARIA);
    const bureauRow = result.breakdown.find((b) => b.signal === 'bureau_score')!;
    expect(bureauRow.rawValue).toBe(720);
    const altRow = result.breakdown.find((b) => b.signal === 'alt_score')!;
    expect(altRow.rawValue).toBe(78);

    const minimal = computeConfidence(SOLO_INTAKE);
    const minBureau = minimal.breakdown.find((b) => b.signal === 'bureau_score')!;
    expect(minBureau.rawValue).toBeNull();
  });
});

describe('computeConfidence — bureau_score signal', () => {
  it('score 720 → contribution 1.0 (techo)', () => {
    const r = computeConfidence({ ...MARIA, bureau: { score: 720, hardInquiriesCount: 0 } });
    const row = r.breakdown.find((b) => b.signal === 'bureau_score')!;
    expect(row.contribution).toBeCloseTo(1.0, 3);
  });

  it('score 500 → contribution 0.0 (piso)', () => {
    const r = computeConfidence({ ...MARIA, bureau: { score: 500, hardInquiriesCount: 0 } });
    const row = r.breakdown.find((b) => b.signal === 'bureau_score')!;
    expect(row.contribution).toBeCloseTo(0.0, 3);
  });

  it('score 610 → contribution 0.5 (medio)', () => {
    const r = computeConfidence({ ...MARIA, bureau: { score: 610, hardInquiriesCount: 0 } });
    const row = r.breakdown.find((b) => b.signal === 'bureau_score')!;
    expect(row.contribution).toBeCloseTo(0.5, 1);
  });

  it('score 380 (debajo de piso) → contribution 0.0 (clamp)', () => {
    const r = computeConfidence({ ...MARIA, bureau: { score: 380, hardInquiriesCount: 0 } });
    const row = r.breakdown.find((b) => b.signal === 'bureau_score')!;
    expect(row.contribution).toBe(0);
  });

  it('score 810 (sobre techo) → contribution 1.0 (clamp)', () => {
    const r = computeConfidence({ ...MARIA, bureau: { score: 810, hardInquiriesCount: 0 } });
    const row = r.breakdown.find((b) => b.signal === 'bureau_score')!;
    expect(row.contribution).toBe(1);
  });

  it('bureau undefined → neutral 0.5 default', () => {
    const r = computeConfidence({ ...MARIA, bureau: undefined });
    const row = r.breakdown.find((b) => b.signal === 'bureau_score')!;
    expect(row.contribution).toBe(0.5);
    expect(row.rawValue).toBeNull();
  });
});

describe('computeConfidence — alt_score signal', () => {
  it('score 80 → contribution 1.0', () => {
    const r = computeConfidence({ ...MARIA, alt_score: { score: 80, signals: ['x'] } });
    const row = r.breakdown.find((b) => b.signal === 'alt_score')!;
    expect(row.contribution).toBeCloseTo(1.0, 3);
  });

  it('score 30 → contribution 0.0', () => {
    const r = computeConfidence({ ...MARIA, alt_score: { score: 30, signals: ['x'] } });
    const row = r.breakdown.find((b) => b.signal === 'alt_score')!;
    expect(row.contribution).toBeCloseTo(0.0, 3);
  });

  it('score 55 → contribution 0.5', () => {
    const r = computeConfidence({ ...MARIA, alt_score: { score: 55, signals: ['x'] } });
    const row = r.breakdown.find((b) => b.signal === 'alt_score')!;
    expect(row.contribution).toBeCloseTo(0.5, 1);
  });

  it('alt_score undefined → neutral 0.5', () => {
    const r = computeConfidence({ ...MARIA, alt_score: undefined });
    const row = r.breakdown.find((b) => b.signal === 'alt_score')!;
    expect(row.contribution).toBe(0.5);
    expect(row.rawValue).toBeNull();
  });
});

describe('computeConfidence — iess_affiliation signal', () => {
  it('afiliado IESS → contribution 1.0', () => {
    const r = computeConfidence(MARIA);
    const row = r.breakdown.find((b) => b.signal === 'iess_affiliation')!;
    expect(row.contribution).toBe(1.0);
  });

  it('autonomo (income undefined) → contribution 0.4 (NO 0)', () => {
    const r = computeConfidence({ ...MARIA, income: undefined });
    const row = r.breakdown.find((b) => b.signal === 'iess_affiliation')!;
    expect(row.contribution).toBe(0.4);
    expect(row.rawValue).toBeNull();
  });
});

describe('computeConfidence — iess_tenure signal', () => {
  it('84 meses (tope) → contribution 1.0', () => {
    const r = computeConfidence({
      ...MARIA,
      income: { employer: 'X', salary: 1000, monthsActive: 84 },
    });
    const row = r.breakdown.find((b) => b.signal === 'iess_tenure')!;
    expect(row.contribution).toBeCloseTo(1.0, 3);
  });

  it('12 meses (piso) → contribution 0.0', () => {
    const r = computeConfidence({
      ...MARIA,
      income: { employer: 'X', salary: 1000, monthsActive: 12 },
    });
    const row = r.breakdown.find((b) => b.signal === 'iess_tenure')!;
    expect(row.contribution).toBeCloseTo(0.0, 3);
  });

  it('48 meses (medio) → contribution 0.5', () => {
    const r = computeConfidence({
      ...MARIA,
      income: { employer: 'X', salary: 1000, monthsActive: 48 },
    });
    const row = r.breakdown.find((b) => b.signal === 'iess_tenure')!;
    expect(row.contribution).toBeCloseTo(0.5, 1);
  });

  it('autonomo → contribution 0 (no aplica tenure si no afiliado)', () => {
    const r = computeConfidence({ ...MARIA, income: undefined });
    const row = r.breakdown.find((b) => b.signal === 'iess_tenure')!;
    expect(row.contribution).toBe(0);
    expect(row.rawValue).toBeNull();
  });

  it('200 meses (sobre techo) → contribution 1.0 (clamp)', () => {
    const r = computeConfidence({
      ...MARIA,
      income: { employer: 'X', salary: 1000, monthsActive: 200 },
    });
    const row = r.breakdown.find((b) => b.signal === 'iess_tenure')!;
    expect(row.contribution).toBe(1);
  });
});

describe('computeConfidence — hard_inquiries signal', () => {
  it('0 inquiries → contribution 1.0', () => {
    const r = computeConfidence({ ...MARIA, bureau: { score: 720, hardInquiriesCount: 0 } });
    const row = r.breakdown.find((b) => b.signal === 'hard_inquiries')!;
    expect(row.contribution).toBe(1.0);
  });

  it('1 inquiry → contribution 0.85', () => {
    const r = computeConfidence({ ...MARIA, bureau: { score: 720, hardInquiriesCount: 1 } });
    const row = r.breakdown.find((b) => b.signal === 'hard_inquiries')!;
    expect(row.contribution).toBeCloseTo(0.85, 2);
  });

  it('2 inquiries → contribution 0.7', () => {
    const r = computeConfidence({ ...MARIA, bureau: { score: 720, hardInquiriesCount: 2 } });
    const row = r.breakdown.find((b) => b.signal === 'hard_inquiries')!;
    expect(row.contribution).toBeCloseTo(0.7, 2);
  });

  it('3 inquiries → contribution 0.0 (espejo MIC-005)', () => {
    const r = computeConfidence({ ...MARIA, bureau: { score: 720, hardInquiriesCount: 3 } });
    const row = r.breakdown.find((b) => b.signal === 'hard_inquiries')!;
    expect(row.contribution).toBe(0);
  });

  it('5 inquiries → contribution 0.0 (clamp)', () => {
    const r = computeConfidence({ ...MARIA, bureau: { score: 720, hardInquiriesCount: 5 } });
    const row = r.breakdown.find((b) => b.signal === 'hard_inquiries')!;
    expect(row.contribution).toBe(0);
  });

  it('bureau undefined → neutral 0.5', () => {
    const r = computeConfidence({ ...MARIA, bureau: undefined });
    const row = r.breakdown.find((b) => b.signal === 'hard_inquiries')!;
    expect(row.contribution).toBe(0.5);
  });
});

describe('computeConfidence — age_band signal', () => {
  it('edad 40 (joven adulto) → contribution 1.0', () => {
    // birthDate 1985-04-12 implica edad ~40 en 2026
    const r = computeConfidence(MARIA);
    const row = r.breakdown.find((b) => b.signal === 'age_band')!;
    expect(row.contribution).toBe(1.0);
  });

  it('edad exactamente 75 → contribution 1.0 (boundary)', () => {
    // hoy 2026-05-06; 75 anos → birthDate 1951-05-06
    const r = computeConfidence({
      ...MARIA,
      identity: { name: 'X', birthDate: '1951-05-06', valid: true },
    });
    const row = r.breakdown.find((b) => b.signal === 'age_band')!;
    expect(row.contribution).toBeCloseTo(1.0, 1);
  });

  it('edad 80 → contribution 0.5 (entre 75 y 85)', () => {
    const r = computeConfidence({
      ...MARIA,
      identity: { name: 'X', birthDate: '1946-05-06', valid: true },
    });
    const row = r.breakdown.find((b) => b.signal === 'age_band')!;
    expect(row.contribution).toBeCloseTo(0.5, 1);
  });

  it('edad 85 (techo) → contribution 0.0', () => {
    const r = computeConfidence({
      ...MARIA,
      identity: { name: 'X', birthDate: '1941-05-06', valid: true },
    });
    const row = r.breakdown.find((b) => b.signal === 'age_band')!;
    expect(row.contribution).toBeCloseTo(0.0, 1);
  });

  it('identity undefined → neutral 0.5', () => {
    const r = computeConfidence({ ...MARIA, identity: undefined });
    const row = r.breakdown.find((b) => b.signal === 'age_band')!;
    expect(row.contribution).toBe(0.5);
    expect(row.rawValue).toBeNull();
  });
});

describe('computeConfidence — clamp & invariants', () => {
  it('value never exceeds 1.0', () => {
    // perfil idealmente sumando techo en cada senal
    const ideal: DecisionInput = {
      cedula: '0102030405',
      ingresos: 5000,
      monto: 1000,
      plazo: 12,
      identity: { name: 'X', birthDate: '1985-04-12', valid: true },
      income: { employer: 'X', salary: 5000, monthsActive: 200 },
      bureau: { score: 820, hardInquiriesCount: 0 },
      alt_score: { score: 100, signals: ['x'] },
    };
    const r = computeConfidence(ideal);
    expect(r.value).toBeLessThanOrEqual(1.0);
  });

  it('value never below 0.0', () => {
    const broken: DecisionInput = {
      cedula: '0102030405',
      ingresos: 100,
      monto: 50000,
      plazo: 6,
      identity: { name: 'X', birthDate: '1939-04-12', valid: true }, // edad 87 → age 0
      income: undefined, // autonomo
      bureau: { score: 350, hardInquiriesCount: 5 },
      alt_score: { score: 10, signals: ['x'] },
    };
    const r = computeConfidence(broken);
    expect(r.value).toBeGreaterThanOrEqual(0.0);
  });
});
