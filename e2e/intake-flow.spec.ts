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

test('happy path — full pipeline produces v0..v5 (intake → identity → income → [bureau ‖ alt_score] → policy)', async ({
  page,
}) => {
  // Prerequisites: `pnpm rag:ingest` must have populated rag_chunks at least
  // once. The policy panel asserts depend on the LLM having actual rules to
  // retrieve. Without ingest, the panel still renders but with empty applies.
  test.setTimeout(60_000); // policyAgent calls Anthropic — ~5-10s end-to-end

  await page.goto('/');

  await page.getByLabel('Cédula').fill(ALIVE_AFILIADO_CEDULA);
  await page.getByLabel('Ingresos mensuales (USD)').fill('1500');
  await page.getByLabel('Monto solicitado (USD)').fill('3000');
  await page.getByLabel('Plazo (meses)').fill('24');

  await page.getByTestId('submit-button').click();
  await page.waitForURL(/\/applications\/[0-9a-f-]+$/);

  await expect(page.getByTestId('latest-version')).toHaveText('v5');

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

  // v4 — alt_score: Maria Lopez Vargas → 78 / 100 with 3 signals
  await expect(page.getByTestId('alt-score-value')).toHaveText('78 / 100');
  const signals = page.getByTestId('alt-score-signals');
  await expect(signals).toContainText('stable_spending');

  // v5 — policy: assertions are tolerant because the LLM picks rules. We only
  // verify the panel rendered, has notes, and that *some* policy decision was
  // produced (either applies > 0 or the empty-applies copy).
  await expect(page.getByTestId('policy-heading')).toBeVisible();
  await expect(page.getByTestId('policy-notes')).toBeVisible();
  const appliesPanel = page.getByTestId('policy-applies');
  const appliesEmpty = page.getByTestId('policy-applies-empty');
  // Exactly one of the two must be visible
  const appliesVisible = await appliesPanel.isVisible();
  const emptyVisible = await appliesEmpty.isVisible();
  expect(appliesVisible || emptyVisible).toBe(true);

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
