import { describe, it, expect } from 'vitest';
import { preDecide } from './preDecide';
import type { DecisionInput } from './types';

const ALIVE_ADULT: DecisionInput = {
  cedula: '0102030405',
  ingresos: 1500,
  monto: 3000,
  plazo: 24,
  identity: { name: 'Maria Lopez', birthDate: '1985-04-12', valid: true },
  income: { employer: 'Banco Pichincha', salary: 1450, monthsActive: 84 },
  bureau: { score: 720, hardInquiriesCount: 1 },
  alt_score: { score: 78, signals: ['x'] },
};

describe('preDecide — happy path returns null', () => {
  it('alive adult with autoritative inputs → null (proceed to confidence)', () => {
    expect(preDecide(ALIVE_ADULT)).toBeNull();
  });
});

describe('preDecide — EXC-001 fallecido', () => {
  it('identity.valid === false → REJECTED hard with EXC-001', () => {
    const result = preDecide({
      ...ALIVE_ADULT,
      identity: { ...ALIVE_ADULT.identity!, valid: false },
    });

    expect(result).not.toBeNull();
    expect(result!.decision).toBe('REJECTED');
    expect(result!.decisionType).toBe('hard_reject');
    expect(result!.confidence).toBe(1.0);
    expect(result!.llmBypassed).toBe(true);
    expect(result!.citedRules).toEqual(['EXC-001']);
    expect(result!.triggeredBy.field).toBe('identity.valid');
    expect(result!.triggeredBy.source).toBe('registro_civil');
    expect(result!.triggeredBy.value).toBe(false);
    expect(result!.reason).toMatch(/fallec/i);
  });

  it('identity undefined → null (cant decide hard, defer to confidence)', () => {
    expect(preDecide({ ...ALIVE_ADULT, identity: undefined })).toBeNull();
  });
});

describe('preDecide — EXC-002 menor de edad', () => {
  it('edad 15 → REJECTED hard with EXC-002', () => {
    // Hoy 2026-05-06; 15 anos → birthDate 2010 o despues
    const result = preDecide({
      ...ALIVE_ADULT,
      identity: { name: 'Juan', birthDate: '2011-01-15', valid: true },
    });

    expect(result).not.toBeNull();
    expect(result!.decision).toBe('REJECTED');
    expect(result!.citedRules).toEqual(['EXC-002']);
    expect(result!.triggeredBy.field).toBe('identity.birthDate');
    expect(result!.triggeredBy.source).toBe('derived');
    expect(result!.triggeredBy.computed).toEqual({ age: expect.any(Number) });
    expect((result!.triggeredBy.computed as { age: number }).age).toBeLessThan(18);
    expect(result!.reason).toMatch(/menor de edad/i);
  });

  it('edad 17 (cerca del limite) → REJECTED', () => {
    const result = preDecide({
      ...ALIVE_ADULT,
      identity: { name: 'Juan', birthDate: '2009-06-01', valid: true },
    });
    expect(result).not.toBeNull();
    expect(result!.citedRules).toEqual(['EXC-002']);
  });

  it('edad 18 (limite) → null (NO hard reject)', () => {
    // Exactamente 18 años hoy. birthDate = hoy - 18 años
    const today = new Date();
    const eighteenYearsAgo = new Date(
      today.getFullYear() - 18,
      today.getMonth(),
      today.getDate(),
    );
    const result = preDecide({
      ...ALIVE_ADULT,
      identity: {
        name: 'X',
        birthDate: eighteenYearsAgo.toISOString().slice(0, 10),
        valid: true,
      },
    });
    expect(result).toBeNull();
  });

  it('senior 80 → null (NO hard reject — overrideable, va a soft confidence)', () => {
    const result = preDecide({
      ...ALIVE_ADULT,
      identity: { name: 'Don Pedro', birthDate: '1946-05-06', valid: true },
    });
    expect(result).toBeNull();
  });
});

describe('preDecide — EXC-003 sobreendeudamiento computable', () => {
  it('cuota_proyectada / salary > 50% con income autoritativo → REJECTED hard', () => {
    // monto 10000 / plazo 12 = cuota 833. Salary 1000. DTI = 0.833 > 0.5
    const result = preDecide({
      ...ALIVE_ADULT,
      monto: 10000,
      plazo: 12,
      income: { employer: 'X', salary: 1000, monthsActive: 24 },
    });
    expect(result).not.toBeNull();
    expect(result!.decision).toBe('REJECTED');
    expect(result!.citedRules).toEqual(['EXC-003']);
    expect(result!.triggeredBy.field).toBe('income.salary');
    expect(result!.triggeredBy.source).toBe('iess');
    expect(result!.triggeredBy.computed).toMatchObject({
      cuotaProyectada: expect.any(Number),
      dti: expect.any(Number),
    });
    expect(result!.reason).toMatch(/sobreendeud/i);
  });

  it('DTI exactamente 50% → null (limite, no rechaza)', () => {
    // monto 6000 / plazo 12 = cuota 500. Salary 1000. DTI = 0.5
    const result = preDecide({
      ...ALIVE_ADULT,
      monto: 6000,
      plazo: 12,
      income: { employer: 'X', salary: 1000, monthsActive: 24 },
    });
    expect(result).toBeNull();
  });

  it('autonomo (sin income.salary) NO se evalua hard reject por DTI', () => {
    // Mismo monto/plazo absurdo pero sin salary autoritativo → null
    const result = preDecide({
      ...ALIVE_ADULT,
      monto: 100000,
      plazo: 6,
      income: undefined,
    });
    expect(result).toBeNull();
  });

  it('income.salary === 0 (edge) → no hard reject (evita div by zero, defer)', () => {
    const result = preDecide({
      ...ALIVE_ADULT,
      income: { employer: 'X', salary: 0, monthsActive: 24 },
    });
    expect(result).toBeNull();
  });
});

describe('preDecide — orden de evaluacion', () => {
  it('fallecido + menor de edad → priorize EXC-001 (mas grave)', () => {
    const result = preDecide({
      ...ALIVE_ADULT,
      identity: { name: 'X', birthDate: '2011-01-15', valid: false },
    });
    expect(result!.citedRules).toEqual(['EXC-001']);
  });

  it('menor + sobreendeudamiento → priorize EXC-002 (eval antes de DTI)', () => {
    const result = preDecide({
      ...ALIVE_ADULT,
      identity: { name: 'X', birthDate: '2011-01-15', valid: true },
      monto: 10000,
      plazo: 12,
      income: { employer: 'X', salary: 1000, monthsActive: 24 },
    });
    expect(result!.citedRules).toEqual(['EXC-002']);
  });
});

describe('preDecide — invariantes regulatorios', () => {
  it('confidence siempre 1.0 en hard reject', () => {
    const result = preDecide({
      ...ALIVE_ADULT,
      identity: { ...ALIVE_ADULT.identity!, valid: false },
    });
    expect(result!.confidence).toBe(1.0);
  });

  it('llmBypassed siempre true en hard reject', () => {
    const result = preDecide({
      ...ALIVE_ADULT,
      identity: { ...ALIVE_ADULT.identity!, valid: false },
    });
    expect(result!.llmBypassed).toBe(true);
  });

  it('source NUNCA es form_input (vetado por construccion del tipo)', () => {
    const result = preDecide({
      ...ALIVE_ADULT,
      monto: 10000,
      plazo: 12,
      income: { employer: 'X', salary: 1000, monthsActive: 24 },
    });
    // EXC-003 usa monto/plazo (form_input) PARA EL CALCULO de cuota,
    // pero el `source` del trigger es 'iess' (income.salary, autoritativo).
    // form_input no aparece como source para hard rejects.
    expect(result!.triggeredBy.source).toBe('iess');
  });

  it('citedRules siempre tiene exactamente 1 elemento', () => {
    const cases = [
      { ...ALIVE_ADULT, identity: { ...ALIVE_ADULT.identity!, valid: false } },
      { ...ALIVE_ADULT, identity: { name: 'X', birthDate: '2011-01-15', valid: true } },
      {
        ...ALIVE_ADULT,
        monto: 10000,
        plazo: 12,
        income: { employer: 'X', salary: 1000, monthsActive: 24 },
      },
    ];
    for (const input of cases) {
      const result = preDecide(input);
      expect(result?.citedRules).toHaveLength(1);
    }
  });
});
