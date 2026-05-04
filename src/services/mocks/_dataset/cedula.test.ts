import { describe, it, expect } from 'vitest';
import { isValidCedula } from './cedula';

describe('isValidCedula — Ecuadorian modulo-10 checksum', () => {
  it('accepts known-valid cedulas', () => {
    // Verificadores calculados con coefs [2,1,2,1,2,1,2,1,2], -9 si >9, 10-(suma%10)
    expect(isValidCedula('0912345675')).toBe(true); // Guayas (09), suma=35, verif=5
    expect(isValidCedula('1710034065')).toBe(true); // Pichincha (17), suma=25, verif=5
    expect(isValidCedula('1712345675')).toBe(true); // Pichincha (17), suma=35, verif=5
  });

  it('rejects cedulas with wrong checksum digit', () => {
    expect(isValidCedula('0912345670')).toBe(false); // verif debería ser 5, dice 0
    expect(isValidCedula('1712345678')).toBe(false); // verif debería ser 5, dice 8
  });

  it('rejects cedulas with provincia > 24', () => {
    expect(isValidCedula('2512345678')).toBe(false);
    expect(isValidCedula('9912345678')).toBe(false);
  });

  it('rejects cedulas with provincia 00', () => {
    expect(isValidCedula('0012345678')).toBe(false);
  });

  it('rejects cedulas where third digit >= 6', () => {
    expect(isValidCedula('0962345678')).toBe(false);
    expect(isValidCedula('0972345678')).toBe(false);
  });

  it('rejects non-10-digit inputs', () => {
    expect(isValidCedula('123')).toBe(false);
    expect(isValidCedula('12345678901')).toBe(false);
    expect(isValidCedula('abc1234567')).toBe(false);
    expect(isValidCedula('')).toBe(false);
  });
});
