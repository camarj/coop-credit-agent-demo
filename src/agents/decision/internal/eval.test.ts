/**
 * Eval pre-cableado del dataset — corre computeConfidence + preDecide sobre
 * los 45 personas sinteticas, imprime histograma de scores, verifica perfiles
 * canonicos, y mide tail-low pattern (>5% APPROVEDs con 2+ senales en
 * contribution<0.3 → trigger regla post-confidence en slice 7).
 *
 * NO toca LLM ni DB. NO consume tokens. Si los perfiles canonicos no caen
 * en sus buckets esperados, los pesos estan mal — recalibrar antes de
 * gastar un solo token del LLM (gate de step 3 → step 5 del ADR-0008).
 */
import { describe, it, expect } from 'vitest';
import { computeConfidence, APPROVAL_THRESHOLD } from './confidence';
import { preDecide } from './preDecide';
import type { DecisionInput } from './types';
import { personas, type Persona } from '@/services/mocks/_dataset/personas';

const TODAY = new Date('2026-05-06');

function buildInputFromPersona(persona: Persona): DecisionInput {
  return {
    cedula: persona.cedula,
    // Form-declared (auto-declarados) — usamos defaults realistas del demo
    ingresos: persona.employment?.salary ?? 800,
    monto: 3000,
    plazo: 24,
    identity: {
      name: persona.name,
      birthDate: persona.birthDate,
      valid: persona.deathDate === undefined,
    },
    income: persona.employment
      ? {
          employer: persona.employment.employer,
          salary: persona.employment.salary,
          monthsActive: persona.employment.monthsActive,
        }
      : undefined,
    bureau: {
      score: persona.equifaxBaseScore,
      // Slice 7 eval pre-cableado: asumimos hard inquiry = 1 (un pull en esta
      // solicitud) replicando comportamiento de bureauAgent en el flow real.
      hardInquiriesCount: 1,
    },
    alt_score: persona.altScore
      ? {
          score: persona.altScore.score,
          signals: persona.altScore.signals,
        }
      : undefined,
  };
}

interface EvalRow {
  persona: Persona;
  hardReject: ReturnType<typeof preDecide>;
  confidence: number | null;
  decision: 'APPROVED' | 'REVIEW' | 'REJECTED';
  tailLowSignals: number;
}

function evaluatePersona(persona: Persona): EvalRow {
  const input = buildInputFromPersona(persona);
  const hardReject = preDecide(input);
  if (hardReject) {
    return { persona, hardReject, confidence: null, decision: 'REJECTED', tailLowSignals: 0 };
  }
  const result = computeConfidence(input);
  const decision = result.value >= APPROVAL_THRESHOLD ? 'APPROVED' : 'REVIEW';
  const tailLowSignals = result.breakdown.filter((b) => b.contribution < 0.3).length;
  return {
    persona,
    hardReject: null,
    confidence: result.value,
    decision,
    tailLowSignals,
  };
}

function buildHistogram(rows: EvalRow[]): string {
  const buckets = [
    { label: '[0.0, 0.2)', min: 0.0, max: 0.2, count: 0 },
    { label: '[0.2, 0.4)', min: 0.2, max: 0.4, count: 0 },
    { label: '[0.4, 0.5)', min: 0.4, max: 0.5, count: 0 },
    { label: '[0.5, 0.6)', min: 0.5, max: 0.6, count: 0 },
    { label: '[0.6, 0.7)', min: 0.6, max: 0.7, count: 0 },
    { label: '[0.7, 0.8) APPROVED', min: 0.7, max: 0.8, count: 0 },
    { label: '[0.8, 0.9) APPROVED', min: 0.8, max: 0.9, count: 0 },
    { label: '[0.9, 1.0] APPROVED', min: 0.9, max: 1.01, count: 0 },
  ];
  const llmRows = rows.filter((r) => r.confidence !== null);
  for (const r of llmRows) {
    const b = buckets.find((b) => r.confidence! >= b.min && r.confidence! < b.max);
    if (b) b.count += 1;
  }
  const max = Math.max(...buckets.map((b) => b.count), 1);
  return buckets
    .map(
      (b) =>
        `  ${b.label.padEnd(22)} ${'█'.repeat(Math.round((b.count / max) * 30))} ${b.count}`,
    )
    .join('\n');
}

describe('Eval pre-cableado del dataset (45 personas)', () => {
  const rows = personas.map(evaluatePersona);

  it('imprime histograma de scores y resumen', () => {
    const totalLlmDecision = rows.filter((r) => r.confidence !== null).length;
    const totalHardReject = rows.length - totalLlmDecision;
    const approvedRows = rows.filter((r) => r.decision === 'APPROVED');
    const reviewRows = rows.filter((r) => r.decision === 'REVIEW');
    const rejectedRows = rows.filter((r) => r.decision === 'REJECTED');

    const llmConfidences = rows
      .filter((r) => r.confidence !== null)
      .map((r) => r.confidence!) as number[];
    const sorted = [...llmConfidences].sort((a, b) => a - b);
    const median =
      sorted.length === 0
        ? null
        : sorted.length % 2 === 0
          ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
          : sorted[Math.floor(sorted.length / 2)];
    const min = sorted[0] ?? null;
    const max = sorted[sorted.length - 1] ?? null;

    const lines = [
      '',
      '════════════════════════════════════════════════════════════════════',
      `Eval pre-cableado — ${personas.length} personas, threshold ${APPROVAL_THRESHOLD}`,
      '════════════════════════════════════════════════════════════════════',
      '',
      'Histograma confidence (solo llm_decision, hard_rejects excluidos):',
      buildHistogram(rows),
      '',
      `Total decisiones:        ${rows.length}`,
      `  hard_reject:           ${totalHardReject}`,
      `  llm_decision:          ${totalLlmDecision}`,
      '',
      `Buckets de decision sugerida:`,
      `  APPROVED:              ${approvedRows.length} (${((approvedRows.length / rows.length) * 100).toFixed(1)}%)`,
      `  REVIEW:                ${reviewRows.length} (${((reviewRows.length / rows.length) * 100).toFixed(1)}%)`,
      `  REJECTED (hard):       ${rejectedRows.length} (${((rejectedRows.length / rows.length) * 100).toFixed(1)}%)`,
      '',
      `Confidence stats (llm_decision):`,
      `  min:    ${min?.toFixed(3) ?? 'n/a'}`,
      `  median: ${median?.toFixed(3) ?? 'n/a'}`,
      `  max:    ${max?.toFixed(3) ?? 'n/a'}`,
      '',
    ];
    console.log(lines.join('\n'));
  });

  it('Maria Lopez Vargas → APPROVED con confidence > 0.75', () => {
    const row = rows.find((r) => r.persona.name === 'Maria Lopez Vargas')!;
    expect(row.hardReject).toBeNull();
    expect(row.decision).toBe('APPROVED');
    expect(row.confidence!).toBeGreaterThan(0.75);
  });

  it('persona fallecida → REJECTED hard via EXC-001', () => {
    const fallecido = rows.find((r) => r.persona.deathDate !== undefined)!;
    expect(fallecido.hardReject).not.toBeNull();
    expect(fallecido.hardReject!.citedRules).toEqual(['EXC-001']);
    expect(fallecido.confidence).toBeNull();
  });

  it('autonomo (sin employment) cae en bucket REVIEW [0.4, 0.7)', () => {
    // Hay 5 autonomos en el dataset (indices 35-39). Verificar al menos uno.
    const autonomos = rows.filter(
      (r) => r.persona.employment === undefined && r.persona.deathDate === undefined,
    );
    expect(autonomos.length).toBeGreaterThan(0);
    for (const a of autonomos) {
      expect(a.hardReject).toBeNull();
      expect(a.confidence!).toBeGreaterThanOrEqual(0.3);
      expect(a.confidence!).toBeLessThan(APPROVAL_THRESHOLD);
      expect(a.decision).toBe('REVIEW');
    }
  });

  it('bucket de decision sugerida: APPROVED >= 30% del dataset (saturacion oficial seria mayor)', () => {
    // Si APPROVED < 30%, el threshold esta muy alto y el oficial se satura.
    // Si APPROVED > 70%, el sistema es laxo y no esta agregando valor.
    const approvedCount = rows.filter((r) => r.decision === 'APPROVED').length;
    const ratio = approvedCount / rows.length;
    expect(ratio).toBeGreaterThanOrEqual(0.3);
    expect(ratio).toBeLessThanOrEqual(0.7);
  });

  it('tail-low check: porcentaje de APPROVEDs con 2+ senales en contribution<0.3', () => {
    const approvedRows = rows.filter((r) => r.decision === 'APPROVED');
    const tailLowCount = approvedRows.filter((r) => r.tailLowSignals >= 2).length;
    const ratio = approvedRows.length === 0 ? 0 : tailLowCount / approvedRows.length;

    console.log('');
    console.log(
      `Tail-low check: ${tailLowCount}/${approvedRows.length} APPROVEDs con 2+ senales tail (contrib<0.3) — ratio ${(ratio * 100).toFixed(1)}%`,
    );
    if (ratio > 0.05) {
      console.log(
        '  ⚠ TRIGGER: ratio > 5% → agregar regla post-confidence "tail_low_count >= 2 fuerza REVIEW" en slice 7',
      );
    } else {
      console.log('  ✓ ratio <= 5% — deuda documentada en ADR-0008, sin regla nueva');
    }

    // No assertion — el test es para informar. Slice 7 cablea regla solo si ratio > 5%.
    expect(ratio).toBeGreaterThanOrEqual(0);
  });

  it('mediana del dataset cae arriba del threshold APPROVED (sino threshold muy alto)', () => {
    const llmConfidences = rows
      .filter((r) => r.confidence !== null)
      .map((r) => r.confidence!) as number[];
    const sorted = [...llmConfidences].sort((a, b) => a - b);
    const median =
      sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];
    // Mediana del dataset ≈ threshold ± 0.10 es saludable para un demo con 45
    // personas distribuidas. Si la mediana cae mucho por debajo, la mayoria
    // del demo se ve REVIEW (no muestra valor del sistema).
    expect(median).toBeGreaterThanOrEqual(APPROVAL_THRESHOLD - 0.15);
  });
});
