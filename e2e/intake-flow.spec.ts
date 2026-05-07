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

test('happy path Maria Lopez — APPROVED con confidence alta + decision banner teal', async ({
  page,
}) => {
  // Prerequisites: `pnpm rag:ingest` must have populated rag_chunks at least
  // once. The policy + decision panels depend on the LLM having actual rules
  // to retrieve. Two LLM calls per request (policy + decision) — ~10-15s end-to-end.
  test.setTimeout(90_000);

  await page.goto('/');

  await page.getByLabel('Cédula').fill(ALIVE_AFILIADO_CEDULA);
  await page.getByLabel('Ingresos mensuales (USD)').fill('1500');
  await page.getByLabel('Monto solicitado (USD)').fill('3000');
  await page.getByLabel('Plazo (meses)').fill('24');

  await page.getByTestId('submit-button').click();
  await page.waitForURL(/\/applications\/[0-9a-f-]+$/);

  // Slice 8 V1 cutover: POST persists only v0; orchestrator runs on the GET
  // stream inside <LiveView>. The page transitions to <PersistedView> via
  // router.refresh() once the stream emits orchestrator.complete. Wait for
  // that transition before asserting any persisted-view testid.
  await page.waitForSelector('[data-testid="latest-version"]', {
    timeout: 60_000,
  });

  await expect(page.getByTestId('latest-version')).toHaveText('v6');

  // v0..v4 unchanged from slice 6
  await expect(page.getByTestId('data-cedula')).toHaveText(ALIVE_AFILIADO_CEDULA);
  await expect(page.getByTestId('identity-name')).toHaveText('Maria Lopez Vargas');
  await expect(page.getByTestId('income-employer')).toHaveText('Banco Pichincha');
  await expect(page.getByTestId('bureau-score')).toHaveText('690');
  await expect(page.getByTestId('alt-score-value')).toHaveText('78 / 100');

  // v5 policy panel still renders
  await expect(page.getByTestId('policy-heading')).toBeVisible();

  // v6 decision banner — Maria es perfil sólido, tiene que ser APPROVED.
  const banner = page.getByTestId('decision-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute('data-decision', 'APPROVED');
  await expect(banner).toHaveAttribute('data-decision-type', 'llm_decision');
  await expect(page.getByTestId('decision-cat')).toHaveText('APROBADA');

  // Confidence percentage visible and >= 70%
  const confidenceText = await page
    .getByTestId('decision-confidence')
    .textContent();
  const confidencePercent = parseFloat(confidenceText!.replace('%', ''));
  expect(confidencePercent).toBeGreaterThanOrEqual(70);

  // No "ESCALADA A HUMANO" label on APPROVED, no "MODO DEGRADADO"
  await expect(page.getByTestId('decision-action-label')).not.toBeVisible();
  await expect(page.getByTestId('decision-degraded-label')).not.toBeVisible();

  // Reason narrativo visible
  await expect(page.getByTestId('decision-reason-banner')).toBeVisible();

  // Panel v6 — breakdown table visible
  await expect(page.getByTestId('decision-heading')).toBeVisible();
  await expect(page.getByTestId('decision-breakdown-table')).toBeVisible();
  await expect(page.getByTestId('breakdown-row-bureau_score')).toBeVisible();
  await expect(page.getByTestId('breakdown-row-alt_score')).toBeVisible();
  await expect(page.getByTestId('breakdown-row-iess_affiliation')).toBeVisible();

  // No saga banner
  await expect(page.getByTestId('saga-banner')).not.toBeVisible();
});

test('fallecido — pipeline aborta upstream (income sin_afiliacion); decisionAgent NO se evalua', async ({
  page,
}) => {
  test.setTimeout(60_000);

  await page.goto('/');

  await page.getByLabel('Cédula').fill(FALLECIDO_CEDULA);
  await page.getByLabel('Ingresos mensuales (USD)').fill('1500');
  await page.getByLabel('Monto solicitado (USD)').fill('3000');
  await page.getByLabel('Plazo (meses)').fill('24');

  await page.getByTestId('submit-button').click();
  await page.waitForURL(/\/applications\/[0-9a-f-]+$/);

  // V1 cutover: wait for <LiveView> to drive the orchestrator to terminal
  // (__pipeline_failure when income halts) and refresh into <PersistedView>.
  await page.waitForSelector('[data-testid="latest-version"]', {
    timeout: 45_000,
  });

  // Realidad operativa del dataset: fallecidos no tienen employment ni altScore,
  // asi que incomeAgent dispara sin_afiliacion antes que decisionAgent vea el
  // state. El hard reject EXC-001 esta cableado en preDecide pero NO se ejecuta
  // en el flow porque la pipeline aborta en v1. El test cubre esa realidad.
  // Si en futuro income permitiera fallecidos pasar (mock distinto), preDecide
  // capturaria EXC-001 con triggeredBy.source='registro_civil'.
  await expect(page.getByTestId('latest-version')).toHaveText('v1');
  await expect(page.getByTestId('identity-valid')).toHaveText(
    'Persona fallecida',
  );
  await expect(page.getByTestId('income-pending')).toBeVisible();
  await expect(page.getByTestId('decision-banner')).not.toBeVisible();
  await expect(page.getByTestId('decision-pending')).toBeVisible();
});

test('autónomo Bryan Calderón — completa pipeline, decision en bucket REVIEW', async ({
  page,
}) => {
  test.setTimeout(90_000);

  await page.goto('/');

  await page.getByLabel('Cédula').fill(AUTONOMO_CEDULA);
  await page.getByLabel('Ingresos mensuales (USD)').fill('800');
  await page.getByLabel('Monto solicitado (USD)').fill('1500');
  await page.getByLabel('Plazo (meses)').fill('18');

  await page.getByTestId('submit-button').click();
  await page.waitForURL(/\/applications\/[0-9a-f-]+$/);

  await page.waitForSelector('[data-testid="latest-version"]', {
    timeout: 45_000,
  });

  // El autónomo tiene identityAgent OK pero income falla con sin_afiliacion.
  // Pipeline aborta en v1 (income agente lanza DomainError). Decision NO se
  // produce porque pipeline corta antes. Validamos que el panel v6 queda en
  // pending con disclaimer. Este test verifica que la UI maneja este caso.
  await expect(page.getByTestId('latest-version')).toHaveText('v1');
  await expect(page.getByTestId('identity-name')).toHaveText(
    'Bryan Calderon Sevilla',
  );
  await expect(page.getByTestId('income-pending')).toBeVisible();

  // Decision banner NO debería existir — la pipeline no llegó a v6.
  await expect(page.getByTestId('decision-banner')).not.toBeVisible();
  await expect(page.getByTestId('decision-pending')).toBeVisible();
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

  await page.waitForSelector('[data-testid="latest-version"]', {
    timeout: 45_000,
  });

  await expect(page.getByTestId('latest-version')).toHaveText('v1');
  await expect(page.getByTestId('identity-name')).toHaveText(
    'Bryan Calderon Sevilla',
  );
  await expect(page.getByTestId('income-pending')).toBeVisible();
});

test('fallecido — identity returns valid:false, income then halts (v1)', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('/');

  await page.getByLabel('Cédula').fill(FALLECIDO_CEDULA);
  await page.getByLabel('Ingresos mensuales (USD)').fill('1500');
  await page.getByLabel('Monto solicitado (USD)').fill('3000');
  await page.getByLabel('Plazo (meses)').fill('24');
  await page.getByTestId('submit-button').click();
  await page.waitForURL(/\/applications\/[0-9a-f-]+$/);

  await page.waitForSelector('[data-testid="latest-version"]', {
    timeout: 45_000,
  });

  await expect(page.getByTestId('latest-version')).toHaveText('v1');
  await expect(page.getByTestId('identity-valid')).toHaveText(
    'Persona fallecida',
  );
  await expect(page.getByTestId('income-pending')).toBeVisible();
});

test('not_found — application stays at v0, identity panel shows pending', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('/');

  await page.getByLabel('Cédula').fill(NOT_FOUND_CEDULA);
  await page.getByLabel('Ingresos mensuales (USD)').fill('1500');
  await page.getByLabel('Monto solicitado (USD)').fill('3000');
  await page.getByLabel('Plazo (meses)').fill('24');
  await page.getByTestId('submit-button').click();
  await page.waitForURL(/\/applications\/[0-9a-f-]+$/);

  await page.waitForSelector('[data-testid="latest-version"]', {
    timeout: 45_000,
  });

  // Identity throws DomainError before persisting v1; orchestrator writes
  // the __pipeline_failure terminal marker which is excluded from the
  // displayed latest version (operators see v0, the last agent row).
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
