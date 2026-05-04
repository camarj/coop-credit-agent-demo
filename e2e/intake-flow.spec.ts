import { test, expect } from '@playwright/test';

// Cedulas computed from the master dataset (src/services/mocks/_dataset/personas.ts).
// personas[0] is alive + has employment ("Maria Lopez Vargas" @ Banco Pichincha).
// personas[35] is alive + no employment (autónomo, "Bryan Calderon Sevilla").
// personas[40] is fallecida ("Eduardo Vinueza Tapia").
// cedulasNotFound[0] has a valid checksum but no matching record.
const ALIVE_AFILIADO_CEDULA = '0100000009';
const AUTONOMO_CEDULA = '1250000054';
const FALLECIDO_CEDULA = '1740000060';
const NOT_FOUND_CEDULA = '2230000073';

test('happy path — full pipeline produces v0, v1 (identity), v2 (income), v3 (bureau)', async ({
  page,
}) => {
  await page.goto('/');

  await page.getByLabel('Cédula').fill(ALIVE_AFILIADO_CEDULA);
  await page.getByLabel('Ingresos mensuales (USD)').fill('1500');
  await page.getByLabel('Monto solicitado (USD)').fill('3000');
  await page.getByLabel('Plazo (meses)').fill('24');

  await page.getByTestId('submit-button').click();
  await page.waitForURL(/\/applications\/[0-9a-f-]+$/);

  await expect(page.getByTestId('latest-version')).toHaveText('v3');

  // v0
  await expect(page.getByTestId('data-cedula')).toHaveText(
    ALIVE_AFILIADO_CEDULA,
  );
  await expect(page.getByTestId('data-monto')).toHaveText('USD 3000');

  // v1
  await expect(page.getByTestId('identity-name')).toHaveText(
    'Maria Lopez Vargas',
  );
  await expect(page.getByTestId('identity-valid')).toHaveText('Válida');

  // v2
  await expect(page.getByTestId('income-employer')).toHaveText('Banco Pichincha');
  await expect(page.getByTestId('income-salary')).toHaveText('USD 1450');
  await expect(page.getByTestId('income-months-active')).toHaveText('84 meses');

  // v3 — bureau: baseScore 720 minus 1 inquiry × 30 = 690
  await expect(page.getByTestId('bureau-score')).toHaveText('690');
  await expect(page.getByTestId('bureau-hard-inquiries')).toHaveText('1');

  // No saga banner on happy path
  await expect(page.getByTestId('saga-banner')).not.toBeVisible();
});

test('autónomo — identity ok, income halts at sin_afiliacion (state stays at v1)', async ({
  page,
}) => {
  await page.goto('/');

  await page.getByLabel('Cédula').fill(AUTONOMO_CEDULA);
  await page.getByLabel('Ingresos mensuales (USD)').fill('1500');
  await page.getByLabel('Monto solicitado (USD)').fill('3000');
  await page.getByLabel('Plazo (meses)').fill('24');
  await page.getByTestId('submit-button').click();
  await page.waitForURL(/\/applications\/[0-9a-f-]+$/);

  await expect(page.getByTestId('latest-version')).toHaveText('v1');
  await expect(page.getByTestId('identity-name')).toHaveText(
    'Bryan Calderon Sevilla',
  );
  await expect(page.getByTestId('income-pending')).toBeVisible();
});

test('fallecido — identity returns valid:false, income then halts (v1)', async ({
  page,
}) => {
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
  await expect(page.getByTestId('income-pending')).toBeVisible();
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
  await expect(page.getByTestId('income-pending')).toBeVisible();
});

test('form submission shows an error message when validation fails', async ({
  page,
}) => {
  await page.goto('/');

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
