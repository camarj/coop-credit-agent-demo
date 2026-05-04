import { describe, it, expect } from 'vitest';
import { isValidCedula } from './cedula';
import { personas, cedulasNotFound } from './personas';

describe('master dataset — personas', () => {
  it('has 45 personas (40 alive + 5 fallecidos)', () => {
    expect(personas).toHaveLength(45);

    const fallecidos = personas.filter((p) => p.deathDate !== undefined);
    expect(fallecidos).toHaveLength(5);

    const vivos = personas.filter((p) => p.deathDate === undefined);
    expect(vivos).toHaveLength(40);
  });

  it('every persona has a valid Ecuadorian cedula checksum', () => {
    for (const p of personas) {
      expect(
        isValidCedula(p.cedula),
        `Invalid cedula in dataset: ${p.cedula} (${p.name})`,
      ).toBe(true);
    }
  });

  it('every persona has non-empty name and ISO birthDate', () => {
    for (const p of personas) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.birthDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('fallecidos have ISO deathDate after birthDate', () => {
    const fallecidos = personas.filter((p) => p.deathDate !== undefined);
    for (const p of fallecidos) {
      expect(p.deathDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.deathDate! > p.birthDate).toBe(true);
    }
  });

  it('cedulas are all unique within personas', () => {
    const set = new Set(personas.map((p) => p.cedula));
    expect(set.size).toBe(personas.length);
  });
});

describe('master dataset — cedulasNotFound', () => {
  it('has exactly 5 cedulas, all valid checksum, none in personas', () => {
    expect(cedulasNotFound).toHaveLength(5);

    for (const c of cedulasNotFound) {
      expect(isValidCedula(c)).toBe(true);
    }

    const personasCedulas = new Set(personas.map((p) => p.cedula));
    for (const c of cedulasNotFound) {
      expect(personasCedulas.has(c)).toBe(false);
    }
  });
});

describe('master dataset — Equifax baseScore', () => {
  it('every persona has equifaxBaseScore in [350, 820]', () => {
    for (const p of personas) {
      expect(p.equifaxBaseScore).toBeGreaterThanOrEqual(350);
      expect(p.equifaxBaseScore).toBeLessThanOrEqual(820);
    }
  });

  it('distribution covers all four bands (alto / medio / bajo / muy bajo)', () => {
    const alto = personas.filter((p) => p.equifaxBaseScore >= 750).length;
    const medio = personas.filter(
      (p) => p.equifaxBaseScore >= 650 && p.equifaxBaseScore < 750,
    ).length;
    const bajo = personas.filter(
      (p) => p.equifaxBaseScore >= 500 && p.equifaxBaseScore < 650,
    ).length;
    const muyBajo = personas.filter((p) => p.equifaxBaseScore < 500).length;

    expect(alto).toBeGreaterThan(0);
    expect(medio).toBeGreaterThan(0);
    expect(bajo).toBeGreaterThan(0);
    expect(muyBajo).toBeGreaterThan(0);
    expect(alto + medio + bajo + muyBajo).toBe(personas.length);
  });
});

describe('master dataset — IESS employment slice', () => {
  it('has exactly 35 vivos with employment data and 5 without (autónomos)', () => {
    const vivos = personas.filter((p) => p.deathDate === undefined);
    const conEmpleo = vivos.filter((p) => p.employment !== undefined);
    const sinEmpleo = vivos.filter((p) => p.employment === undefined);

    expect(conEmpleo).toHaveLength(35);
    expect(sinEmpleo).toHaveLength(5);
  });

  it('every fallecido has no employment record', () => {
    const fallecidos = personas.filter((p) => p.deathDate !== undefined);
    for (const p of fallecidos) {
      expect(p.employment).toBeUndefined();
    }
  });

  it('every employment entry has positive salary and monthsActive', () => {
    const conEmpleo = personas.filter((p) => p.employment !== undefined);
    for (const p of conEmpleo) {
      expect(p.employment!.employer.length).toBeGreaterThan(0);
      expect(p.employment!.salary).toBeGreaterThan(0);
      expect(p.employment!.monthsActive).toBeGreaterThan(0);
    }
  });
});
