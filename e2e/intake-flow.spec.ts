import { test, expect } from '@playwright/test';

test('form submission persists state v0 and redirects to /applications/[id]', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'coop-credit-agent' })).toBeVisible();

  await page.getByLabel('Cédula').fill('1712345678');
  await page.getByLabel('Ingresos mensuales (USD)').fill('1500');
  await page.getByLabel('Monto solicitado (USD)').fill('3000');
  await page.getByLabel('Plazo (meses)').fill('24');

  await page.getByTestId('submit-button').click();

  await page.waitForURL(/\/applications\/[0-9a-f-]+$/);

  await expect(page.getByRole('heading', { name: 'Solicitud recibida' })).toBeVisible();
  await expect(page.getByTestId('latest-version')).toHaveText('v0');
  await expect(page.getByTestId('data-cedula')).toHaveText('1712345678');
  await expect(page.getByTestId('data-ingresos')).toHaveText('USD 1500');
  await expect(page.getByTestId('data-monto')).toHaveText('USD 3000');
  await expect(page.getByTestId('data-plazo')).toHaveText('24 meses');
});

test('form submission shows an error message when validation fails', async ({
  page,
}) => {
  await page.goto('/');

  // Bypass HTML5 validation by editing the input via JS (real submit, but invalid payload)
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
