const COEFFICIENTS = [2, 1, 2, 1, 2, 1, 2, 1, 2];

/**
 * Validates an Ecuadorian cedula using the official modulo-10 algorithm.
 * Rules:
 *  - Exactly 10 numeric digits
 *  - Provincia (digits 1-2) in [01, 24]
 *  - Third digit < 6 (natural persons)
 *  - Verificador (digit 10) matches checksum of digits 1-9
 */
export function isValidCedula(input: string): boolean {
  if (!/^\d{10}$/.test(input)) return false;

  const provincia = parseInt(input.slice(0, 2), 10);
  if (provincia < 1 || provincia > 24) return false;

  const thirdDigit = parseInt(input[2], 10);
  if (thirdDigit >= 6) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let product = parseInt(input[i], 10) * COEFFICIENTS[i];
    if (product > 9) product -= 9;
    sum += product;
  }

  const expectedVerifier = (10 - (sum % 10)) % 10;
  const actualVerifier = parseInt(input[9], 10);

  return expectedVerifier === actualVerifier;
}

/**
 * Builds a valid cedula given the first 9 digits. Used to seed dataset entries
 * deterministically without hand-calculating the checksum.
 */
export function buildCedula(firstNine: string): string {
  if (!/^\d{9}$/.test(firstNine)) {
    throw new Error('buildCedula expects exactly 9 digits');
  }
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let product = parseInt(firstNine[i], 10) * COEFFICIENTS[i];
    if (product > 9) product -= 9;
    sum += product;
  }
  const verifier = (10 - (sum % 10)) % 10;
  return firstNine + verifier.toString();
}
