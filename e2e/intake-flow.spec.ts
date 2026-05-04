import { test, expect } from '@playwright/test';

// Cedulas computed from the master dataset (src/services/mocks/_dataset/personas.ts).
// personas[0] is alive ("Maria Lopez Vargas"). personas[40] is fallecida.
// cedulasNotFound[0] has a valid checksum but no matching record.
const ALIVE_CEDULA = '0100000009';
const FALLECIDO_CEDULA = '1740000060';
const NOT_FOUND_CEDULA = '2230000073';

test('happy path — intake + identity produce v0 and v1, identity is valid', async ({
  page,
}) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'coop-credit-agent' }),
  ).toBeVisible();

  await page.getByLabel('Cédula').fill(ALIVE_CEDULA);
  await page.getByLabel('Ingresos mensuales (USD)').fill('1500');
  await page.getByLabel('Monto solicitado (USD)').fill('3000');
  await page.getByLabel('Plazo (meses)').fill('24');

  await page.getByTestId('submit-button').click();
  await page.waitForURL(/\/applications\/[0-9a-f-]+$/);

  await expect(page.getByTestId('latest-version')).toHaveText('v1');

  // v0 — intake fields
  await expect(page.getByTestId('data-cedula')).toHaveText(ALIVE_CEDULA);
  await expect(page.getByTestId('data-ingresos')).toHaveText('USD 1500');
  await expect(page.getByTestId('data-monto')).toHaveText('USD 3000');
  await expect(page.getByTestId('data-plazo')).toHaveText('24 meses');

  // v1 — identity contribution
  await expect(page.getByTestId('identity-name')).toHaveText(
    'Maria Lopez Vargas',
  );
  await expect(page.getByTestId('identity-birthdate')).toHaveText('1985-04-12');
  await expect(page.getByTestId('identity-valid')).toHaveText('Válida');
});

test('fallecido — identity resolves with valid: false', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Cédula').fill(FALLECIDO_CEDULA);
  await page.getByLabel('Ingresos mensuales (USD)').fill('1500');
  await page.getByLabel('Monto solicitado (USD)').fill('3000');
  await page.getByLabel('Plazo (meses)').fill('24');
  await page.getByTestId('submit-button').click();
  await page.waitForURL(/\/applications\/[0-9a-f-]+$/);

  await expect(page.getByTestId('latest-version')).toHaveText('v1');
  await expect(page.getByTestId('identity-valid')).toHaveText(
    'Persona fallecida',
  );
});

test('not_found — application stays at v0, identity panel shows pending', async ({
  page,
}) => {
  await page.goto('/');

  await page.getByLabel('Cédula').fill(NOT_FOUND_CEDULA);
  await page.getByLabel('Ingresos mensuales (USD)').fill('1500');
  await page.getByLabel('Monto solicitado (USD)').fill('3000');
  await page.getByLabel('Plazo (meses)').fill('24');
  await page.getByTestId('submit-button').click();
  await page.waitForURL(/\/applications\/[0-9a-f-]+$/);

  await expect(page.getByTestId('latest-version')).toHaveText('v0');
  await expect(page.getByTestId('identity-pending')).toBeVisible();
});

test('form submission shows an error message when validation fails', async ({
  page,
}) => {
  await page.goto('/');

  // Bypass HTML5 validation to send a payload with invalid cedula format
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('#cedula');
    if (input) {
      input.removeAttribute('pattern');
      input.removeAttribute('required');
      input.value = 'NOT_VALID';
    }
  });

  await page.getByLabel('Ingresos mensuales (USD)').fill('1500');
  await page.getByLabel('Monto solicitado (USD)').fill('3000');
  await page.getByLabel('Plazo (meses)').fill('24');

  await page.getByTestId('submit-button').click();

  await expect(page.getByTestId('form-error')).toBeVisible();
});
