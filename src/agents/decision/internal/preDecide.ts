import type { DecisionInput, HardRejectOutput } from './types';
import { computeAge } from './confidence';

/**
 * DTI threshold for hard reject. Espejo de EXC-003 — actualizar ambos juntos
 * (markdown corpus + esta constante) si la cooperativa cambia el limite.
 *
 * Slice 7 limitation: hoy `deudasExistentes` es placeholder = 0 porque el
 * EquifaxMock NO expone monthly debt payments. La cuota proyectada del
 * NUEVO credito sola se compara contra el sueldo. Cuando bureau exponga
 * `monthlyDebtPayments`, se suma aqui sin cambiar el contrato del agente.
 * Documentado en ADR-0008 seccion 2.
 */
const DTI_HARD_REJECT_THRESHOLD = 0.5;

/**
 * MIN_AGE constitucional. Espejo del lado "menor" de EXC-002. La capacidad
 * legal en Ecuador es 18 — sin override de producto posible.
 */
const MIN_AGE_LEGAL = 18;

/**
 * preDecide is a PURE function — no IO, no LLM, no DB. Returns a hard reject
 * (which bypasses LLM completely) or null (caller proceeds to confidence
 * + LLM). Only consumes AUTHORITATIVE fields — see ADR-0008 section 3.
 *
 * Auto-declared inputs (`ingresos`, `monto`, `plazo`) NEVER feed preDecide
 * directly. The DTI calculation uses `monto/plazo` as a derived value, but
 * the `source` of the triggered rule is the autoritative field
 * (`income.salary` from IESS) — auto-declared inputs cannot disparar hard
 * reject by themselves.
 *
 * Order of evaluation (most severe first):
 *   1. EXC-001 — fallecido (suplantation indicator)
 *   2. EXC-002 — menor de edad (capacidad legal)
 *   3. EXC-003 — sobreendeudamiento computable (solo si income.salary)
 */
export function preDecide(input: DecisionInput): HardRejectOutput | null {
  // EXC-001: persona fallecida (suplantation indicator)
  if (input.identity?.valid === false) {
    return {
      decision: 'REJECTED',
      decisionType: 'hard_reject',
      confidence: 1.0,
      llmBypassed: true,
      triggeredBy: {
        field: 'identity.valid',
        source: 'registro_civil',
        value: false,
      },
      citedRules: ['EXC-001'],
      reason:
        'Solicitud rechazada por regla constitucional EXC-001: el Registro Civil reporta la cedula como fallecida. Caso reportable al equipo de prevencion de fraude.',
    };
  }

  // EXC-002: menor de edad (capacidad legal constitucional)
  if (input.identity?.birthDate) {
    const age = computeAge(input.identity.birthDate);
    if (age < MIN_AGE_LEGAL) {
      return {
        decision: 'REJECTED',
        decisionType: 'hard_reject',
        confidence: 1.0,
        llmBypassed: true,
        triggeredBy: {
          field: 'identity.birthDate',
          source: 'derived',
          value: input.identity.birthDate,
          computed: { age },
        },
        citedRules: ['EXC-002'],
        reason: `Solicitud rechazada por regla constitucional EXC-002: solicitante menor de edad (${age} anios), por debajo del minimo legal de ${MIN_AGE_LEGAL}. Sin override de producto posible (capacidad legal constitucional ecuatoriana). Sugerimos cuenta de ahorro juvenil.`,
      };
    }
  }

  // EXC-003: sobreendeudamiento computable. Solo evaluable cuando
  // income.salary es autoritativo (viene del IESS). Para autonomos sin
  // sueldo verificado, la regla degrada a soft signal en computeConfidence.
  const salary = input.income?.salary;
  if (salary !== undefined && salary > 0 && input.plazo > 0) {
    const cuotaProyectada = input.monto / input.plazo; // simplificado, sin tasa
    const deudasExistentes = 0; // placeholder — ver comentario en const arriba
    const dti = (deudasExistentes + cuotaProyectada) / salary;
    if (dti > DTI_HARD_REJECT_THRESHOLD) {
      return {
        decision: 'REJECTED',
        decisionType: 'hard_reject',
        confidence: 1.0,
        llmBypassed: true,
        triggeredBy: {
          field: 'income.salary',
          source: 'iess',
          value: salary,
          computed: {
            cuotaProyectada: round2(cuotaProyectada),
            dti: round2(dti),
            threshold: DTI_HARD_REJECT_THRESHOLD,
          },
        },
        citedRules: ['EXC-003'],
        reason: `Solicitud rechazada por regla constitucional EXC-003: sobreendeudamiento computable. La cuota proyectada del credito (${round2(cuotaProyectada)}/mes) sobre el sueldo verificado IESS (${salary}/mes) implica un ratio de ${(dti * 100).toFixed(1)}%, superior al limite del ${(DTI_HARD_REJECT_THRESHOLD * 100).toFixed(0)}%. La razon cuota/ingreso es predictor fuerte de default.`,
      };
    }
  }

  return null;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
