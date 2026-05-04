import { describe, it, expect } from 'vitest';
import { intakeInputSchema } from '@/services/intake';

describe('intakeInputSchema — cedula', () => {
  const validRest = { ingresos: 1500, monto: 3000, plazo: 24 };

  it('accepts a well-formed cedula (10 digits)', () => {
    const result = intakeInputSchema.safeParse({
      cedula: '1712345678',
      ...validRest,
    });
    expect(result.success).toBe(true);
  });

  it('rejects cedulas that are not exactly 10 digits', () => {
    const cases = ['', '1', '12345', '123456789', '12345678901', '1'.repeat(20)];
    for (const cedula of cases) {
      const result = intakeInputSchema.safeParse({ cedula, ...validRest });
      expect(result.success, `expected cedula "${cedula}" to be rejected`).toBe(false);
    }
  });

  it('rejects cedulas with non-numeric characters', () => {
    const cases = ['abcdefghij', '1712 34567', '1712-34567', '171234567X', '171234567 '];
    for (const cedula of cases) {
      const result = intakeInputSchema.safeParse({ cedula, ...validRest });
      expect(result.success, `expected cedula "${cedula}" to be rejected`).toBe(false);
    }
  });
});

describe('intakeInputSchema — monto', () => {
  const validRest = { cedula: '1712345678', ingresos: 1500, plazo: 24 };

  it('accepts monto inside [100, 50000]', () => {
    for (const monto of [100, 5000, 50000]) {
      const result = intakeInputSchema.safeParse({ ...validRest, monto });
      expect(result.success, `expected monto ${monto} to be accepted`).toBe(true);
    }
  });

  it('rejects monto below 100', () => {
    for (const monto of [0, -1, 50, 99, 99.99]) {
      const result = intakeInputSchema.safeParse({ ...validRest, monto });
      expect(result.success, `expected monto ${monto} to be rejected`).toBe(false);
    }
  });

  it('rejects monto above 50000', () => {
    for (const monto of [50001, 100000, 999999]) {
      const result = intakeInputSchema.safeParse({ ...validRest, monto });
      expect(result.success, `expected monto ${monto} to be rejected`).toBe(false);
    }
  });
});

describe('intakeInputSchema — plazo', () => {
  const validRest = { cedula: '1712345678', ingresos: 1500, monto: 3000 };

  it('accepts plazo in [1, 60] months', () => {
    for (const plazo of [1, 12, 24, 36, 60]) {
      const result = intakeInputSchema.safeParse({ ...validRest, plazo });
      expect(result.success, `expected plazo ${plazo} to be accepted`).toBe(true);
    }
  });

  it('rejects plazo above 60', () => {
    for (const plazo of [61, 72, 120, 999]) {
      const result = intakeInputSchema.safeParse({ ...validRest, plazo });
      expect(result.success, `expected plazo ${plazo} to be rejected`).toBe(false);
    }
  });

  it('rejects plazo below 1 or non-integer', () => {
    for (const plazo of [0, -1, -10, 12.5, 24.7]) {
      const result = intakeInputSchema.safeParse({ ...validRest, plazo });
      expect(result.success, `expected plazo ${plazo} to be rejected`).toBe(false);
    }
  });
});
