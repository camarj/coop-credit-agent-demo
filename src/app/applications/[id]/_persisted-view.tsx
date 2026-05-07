import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { InferSelectModel } from 'drizzle-orm';
import { parsePolicyCorpus } from '@/lib/rag/parser';
import type { PolicyChunk } from '@/lib/rag/types';
import type { applicationStates as applicationStatesTable } from '@/db/schema';
import './_persisted-view.css';

type StateRow = InferSelectModel<typeof applicationStatesTable>;

const policyChunksByRuleId: Map<string, PolicyChunk> = (() => {
  try {
    const corpusPath = path.resolve(
      process.cwd(),
      'docs/policy/cooperativa-policy.md',
    );
    const source = readFileSync(corpusPath, 'utf-8');
    const chunks = parsePolicyCorpus(source);
    return new Map(chunks.map((c) => [c.ruleId, c]));
  } catch {
    return new Map();
  }
})();

interface PersistedViewProps {
  applicationId: string;
  states: StateRow[];
}

interface IntakeContribution {
  cedula: string;
  ingresos: number;
  monto: number;
  plazo: number;
}

interface IdentityContribution {
  identity: { name: string; birthDate: string; valid: boolean };
}

interface IncomeContribution {
  income: { employer: string; salary: number; monthsActive: number };
}

interface BureauContribution {
  bureau: {
    score: number;
    history: Array<{ at: number; source: string }>;
    hardInquiriesCount: number;
  };
}

interface AltScoreContribution {
  alt_score: { score: number; signals: string[] };
}

interface PolicyContribution {
  policy: { applies: string[]; notes: string };
}

interface SignalContributionRow {
  signal: string;
  weight: number;
  rawValue: number | null;
  contribution: number;
  weighted: number;
}

interface DecisionContribution {
  decision: {
    decision: 'APPROVED' | 'REJECTED' | 'REVIEW';
    decisionType: 'hard_reject' | 'llm_decision';
    confidence: number;
    llmBypassed: boolean;
    reason: string;
    citedRules: string[];
    triggeredBy?: {
      field: string;
      source: string;
      value: unknown;
      computed?: Record<string, unknown>;
    };
    breakdown?: SignalContributionRow[];
    modelRequested?: string;
    modelActual?: string;
    degraded?: boolean;
  };
}

interface SagaContribution {
  __saga: {
    type: 'saga';
    failedAgent: string;
    failedAt: string;
    compensatedAgents: string[];
    reason: string;
    completedAt: string;
  };
}

export async function PersistedView({ applicationId: id, states }: PersistedViewProps) {
  const v0 = states.find((s) => s.version === 0);
  const intake = v0?.contribution as IntakeContribution | undefined;

  const v1 = states.find((s) => s.version === 1);
  const identityContribution = v1?.contribution as IdentityContribution | undefined;
  const identity = identityContribution?.identity;

  const v2 = states.find((s) => s.version === 2);
  const incomeContribution = v2?.contribution as IncomeContribution | undefined;
  const income = incomeContribution?.income;

  const bureauRow = states.find((s) => s.createdByAgent === 'bureau');
  const bureauContribution = bureauRow?.contribution as BureauContribution | undefined;
  const bureau = bureauContribution?.bureau;

  const altScoreRow = states.find((s) => s.createdByAgent === 'alt_score');
  const altScoreContribution = altScoreRow?.contribution as AltScoreContribution | undefined;
  const altScore = altScoreContribution?.alt_score;

  const policyRow = states.find((s) => s.createdByAgent === 'policy');
  const policyContribution = policyRow?.contribution as PolicyContribution | undefined;
  const policy = policyContribution?.policy;

  const decisionRow = states.find((s) => s.createdByAgent === 'decision');
  const decisionContribution = decisionRow?.contribution as DecisionContribution | undefined;
  const decision = decisionContribution?.decision;

  const sagaRow = states.find((s) => s.createdByAgent === 'orchestrator');
  const sagaContribution = sagaRow?.contribution as SagaContribution | undefined;
  const saga = sagaContribution?.__saga;

  const lastAgentRow = [...states]
    .reverse()
    .find((s) => s.createdByAgent !== 'orchestrator');
  const latestVersion = lastAgentRow?.version ?? null;

  const decisionStyle = (() => {
    if (!decision) return null;
    if (decision.decision === 'APPROVED') {
      return { tone: 'approved' as const, label: '', cat: 'APROBADA' };
    }
    if (decision.decision === 'REJECTED') {
      return {
        tone: 'rejected' as const,
        label: 'NOTIFICAR AL CLIENTE',
        cat: 'RECHAZO AUTOMATICO',
      };
    }
    return {
      tone: 'review' as const,
      label: 'ESCALADA A HUMANO',
      cat: 'EN REVISION',
    };
  })();

  return (
    <main className="dashboard">
      <header className="dashboard__header">
        <div className="entry-meta">
          <span className="cat">SOLICITUD</span>
          <span>·</span>
          <span data-testid="application-id">{id}</span>
          <span>·</span>
          <span data-testid="latest-version">v{latestVersion ?? '?'}</span>
        </div>
      </header>

      {saga && (
        <aside
          className="dashboard__saga"
          data-testid="saga-banner"
        >
          <div className="entry-meta">
            <span className="cat">SAGA</span>
            <span>·</span>
            <span>{new Date(saga.completedAt).toISOString()}</span>
          </div>
          <p>
            Solicitud abortada. El orquestador compensó{' '}
            <span data-testid="saga-compensated">
              {saga.compensatedAgents.join(', ')}
            </span>
            {' '}para revertir efectos colaterales.
          </p>
          <p className="dashboard__saga-reason">
            Razón: <span data-testid="saga-reason">{saga.reason}</span>
          </p>
        </aside>
      )}

      {decision && decisionStyle && (
        <section
          className="dashboard__decision"
          data-tone={decisionStyle.tone}
          data-testid="decision-banner"
          data-decision={decision.decision}
          data-decision-type={decision.decisionType}
        >
          <div className="dashboard__decision-meta entry-meta">
            <span className="cat">DECISION SUGERIDA</span>
            <span>·</span>
            <span data-testid="decision-cat">{decisionStyle.cat}</span>
            {decisionStyle.label && (
              <>
                <span>·</span>
                <span
                  data-testid="decision-action-label"
                  className="dashboard__decision-label"
                >
                  {decisionStyle.label}
                </span>
              </>
            )}
            {decision.degraded && (
              <>
                <span>·</span>
                <span
                  data-testid="decision-degraded-label"
                  className="dashboard__decision-degraded"
                >
                  MODO DEGRADADO
                </span>
              </>
            )}
          </div>

          <div className="dashboard__decision-body">
            <div className="dashboard__decision-headline">
              <h1 className="dashboard__decision-verdict">
                {decision.decision === 'APPROVED'
                  ? 'Aprobada'
                  : decision.decision === 'REJECTED'
                    ? 'Rechazada'
                    : 'En revisión'}
              </h1>
              <p
                className="dashboard__decision-confidence"
                data-testid="decision-confidence-meta"
              >
                Confianza{' '}
                <strong data-testid="decision-confidence">
                  {(decision.confidence * 100).toFixed(1)}%
                </strong>{' '}
                ·{' '}
                <span data-testid="decision-cited-rules-count">
                  {decision.citedRules.length}
                </span>{' '}
                {decision.citedRules.length === 1 ? 'regla citada' : 'reglas citadas'}
              </p>
            </div>
            <p
              className="dashboard__decision-reason serif-italic"
              data-testid="decision-reason-banner"
            >
              {decision.reason}
            </p>
          </div>
        </section>
      )}

      {!decision && !saga && (
        <section className="dashboard__decision dashboard__decision--pending">
          <div className="entry-meta">
            <span className="cat">DECISION SUGERIDA</span>
            <span>·</span>
            <span>PENDIENTE</span>
          </div>
          <p
            className="dashboard__decision-pending"
            data-testid="decision-pending"
          >
            La decisión sugerida no se completó para esta solicitud.
          </p>
        </section>
      )}

      <div className="dashboard__grid">
        {/* CARD 1 — Identidad */}
        <article className="dashboard__card" data-testid="card-identity">
          <header className="dashboard__card-header">
            <span className="cat">v1 · IDENTIDAD</span>
          </header>
          {identity ? (
            <dl className="dashboard__card-data">
              <div>
                <dt>Nombre</dt>
                <dd data-testid="identity-name">{identity.name}</dd>
              </div>
              <div>
                <dt>Nacimiento</dt>
                <dd data-testid="identity-birthdate">{identity.birthDate}</dd>
              </div>
              <div>
                <dt>Estado</dt>
                <dd data-testid="identity-valid">
                  {identity.valid ? 'Válida' : 'Persona fallecida'}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="dashboard__card-pending" data-testid="identity-pending">
              Cédula no verificada.
            </p>
          )}
        </article>

        {/* CARD 2 — Ingresos */}
        <article className="dashboard__card" data-testid="card-income">
          <header className="dashboard__card-header">
            <span className="cat">v2 · INGRESOS</span>
          </header>
          {income ? (
            <dl className="dashboard__card-data">
              <div>
                <dt>Empleador</dt>
                <dd data-testid="income-employer">{income.employer}</dd>
              </div>
              <div>
                <dt>Sueldo IESS</dt>
                <dd data-testid="income-salary">USD {income.salary}</dd>
              </div>
              <div>
                <dt>Antigüedad</dt>
                <dd data-testid="income-months-active">{income.monthsActive} meses</dd>
              </div>
            </dl>
          ) : (
            <p className="dashboard__card-pending" data-testid="income-pending">
              Sin afiliación IESS activa.
            </p>
          )}
        </article>

        {/* CARD 3 — Buró */}
        <article className="dashboard__card" data-testid="card-bureau">
          <header className="dashboard__card-header">
            <span className="cat">v3 · BURÓ</span>
          </header>
          {bureau ? (
            <dl className="dashboard__card-data">
              <div>
                <dt>Score</dt>
                <dd
                  className="dashboard__card-metric"
                  data-testid="bureau-score"
                >
                  {bureau.score}
                </dd>
              </div>
              <div>
                <dt>Hard inquiries</dt>
                <dd data-testid="bureau-hard-inquiries">{bureau.hardInquiriesCount}</dd>
              </div>
              <div>
                <dt>Historial</dt>
                <dd>{bureau.history.length} registros</dd>
              </div>
            </dl>
          ) : (
            <p className="dashboard__card-pending" data-testid="bureau-pending">
              Sin reporte crediticio.
            </p>
          )}
        </article>

        {/* CARD 4 — Score alternativo */}
        <article className="dashboard__card" data-testid="card-alt-score">
          <header className="dashboard__card-header">
            <span className="cat">v4 · SCORE ALT.</span>
          </header>
          {altScore ? (
            <>
              <dl className="dashboard__card-data">
                <div>
                  <dt>Score sintético</dt>
                  <dd
                    className="dashboard__card-metric"
                    data-testid="alt-score-value"
                  >
                    {altScore.score} / 100
                  </dd>
                </div>
              </dl>
              <ul
                className="dashboard__chips"
                data-testid="alt-score-signals"
              >
                {altScore.signals.map((signal) => (
                  <li key={signal} className="chip-teal">{signal}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="dashboard__card-pending" data-testid="alt-score-pending">
              Sin cobertura de datos alternativos.
            </p>
          )}
        </article>

        {/* CARD 5 — Política */}
        <article className="dashboard__card" data-testid="card-policy">
          <header className="dashboard__card-header">
            <span className="cat" data-testid="policy-heading">v5 · POLÍTICA</span>
          </header>
          {policy ? (
            <>
              {policy.applies.length > 0 ? (
                <ul className="dashboard__chips" data-testid="policy-applies">
                  {policy.applies.map((ruleId) => (
                    <li
                      key={ruleId}
                      className="chip-teal"
                      data-testid={`policy-rule-${ruleId}`}
                    >
                      {ruleId}
                    </li>
                  ))}
                </ul>
              ) : (
                <p
                  data-testid="policy-applies-empty"
                  className="dashboard__card-empty"
                >
                  Ninguna regla aplica claramente.
                </p>
              )}
              <p
                className="dashboard__card-notes serif-italic"
                data-testid="policy-notes"
              >
                {policy.notes}
              </p>
              {policy.applies.length > 0 && (
                <details className="dashboard__card-details">
                  <summary>Ver reglas completas</summary>
                  <div className="dashboard__rules">
                    {policy.applies.map((ruleId) => {
                      const chunk = policyChunksByRuleId.get(ruleId);
                      return (
                        <div
                          key={ruleId}
                          id={`policy-rule-${ruleId}`}
                          data-testid={`policy-rule-detail-${ruleId}`}
                        >
                          {chunk ? (
                            <pre>{chunk.fullText}</pre>
                          ) : (
                            <p>Regla {ruleId} no encontrada en el corpus.</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}
            </>
          ) : (
            <p className="dashboard__card-pending" data-testid="policy-pending">
              Política no evaluada.
            </p>
          )}
        </article>

        {/* CARD 6 — Breakdown / Trazabilidad */}
        <article className="dashboard__card" data-testid="card-breakdown">
          <header className="dashboard__card-header">
            <span className="cat" data-testid="decision-heading">v6 · CÓMO SE DECIDIÓ</span>
          </header>
          {decision ? (
            <>
              <dl className="dashboard__card-data">
                <div>
                  <dt>Tipo</dt>
                  <dd data-testid="decision-summary">
                    <span className="dashboard__decision-type-tag">
                      {decision.decisionType === 'hard_reject'
                        ? 'hard_reject'
                        : 'llm_decision'}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Confianza</dt>
                  <dd
                    className="dashboard__card-metric"
                    data-testid="decision-confidence-detailed"
                  >
                    {(decision.confidence * 100).toFixed(1)}%
                  </dd>
                </div>
              </dl>

              {decision.degraded && (
                <p
                  data-testid="decision-degraded-disclaimer"
                  className="dashboard__card-degraded"
                >
                  Modo degradado:{' '}
                  <span data-testid="decision-degraded-reason">
                    {decision.modelRequested && decision.modelActual
                      ? `${decision.modelRequested} → ${decision.modelActual}`
                      : 'fallback canned'}
                  </span>
                </p>
              )}

              {decision.decisionType === 'hard_reject' && decision.triggeredBy && (
                <dl
                  className="dashboard__audit"
                  data-testid="decision-triggered-by"
                >
                  <div>
                    <dt>Regla</dt>
                    <dd>{decision.citedRules[0] ?? 'EXC-???'}</dd>
                  </div>
                  <div>
                    <dt>Campo</dt>
                    <dd>{decision.triggeredBy.field}</dd>
                  </div>
                  <div>
                    <dt>Fuente</dt>
                    <dd>{decision.triggeredBy.source}</dd>
                  </div>
                  <div>
                    <dt>Valor</dt>
                    <dd>{String(decision.triggeredBy.value)}</dd>
                  </div>
                </dl>
              )}

              {decision.decisionType === 'llm_decision' && decision.breakdown && (
                <table
                  className="dashboard__breakdown"
                  data-testid="decision-breakdown-table"
                >
                  <thead>
                    <tr>
                      <th>Señal</th>
                      <th>Valor</th>
                      <th>Aporta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decision.breakdown.map((row) => (
                      <tr
                        key={row.signal}
                        data-testid={`breakdown-row-${row.signal}`}
                      >
                        <td>{humanizeSignal(row.signal)}</td>
                        <td>{humanizeRawValue(row.signal, row.rawValue)}</td>
                        <td className="num">{(row.weighted * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                    <tr className="dashboard__breakdown-total">
                      <td>Total</td>
                      <td></td>
                      <td className="num">
                        {(decision.confidence * 100).toFixed(1)}%
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}

              <details
                className="dashboard__card-details"
                data-testid="decision-telemetry-details"
              >
                <summary>Detalle del solicitante e intake</summary>
                <dl className="dashboard__intake-details">
                  <div>
                    <dt>Cédula</dt>
                    <dd data-testid="data-cedula">{intake?.cedula}</dd>
                  </div>
                  <div>
                    <dt>Ingresos declarados</dt>
                    <dd data-testid="data-ingresos">USD {intake?.ingresos}</dd>
                  </div>
                  <div>
                    <dt>Monto solicitado</dt>
                    <dd data-testid="data-monto">USD {intake?.monto}</dd>
                  </div>
                  <div>
                    <dt>Plazo</dt>
                    <dd data-testid="data-plazo">{intake?.plazo} meses</dd>
                  </div>
                  {decision.modelRequested && (
                    <div>
                      <dt>Modelo solicitado</dt>
                      <dd>{decision.modelRequested}</dd>
                    </div>
                  )}
                  {decision.modelActual && (
                    <div>
                      <dt>Modelo usado</dt>
                      <dd>{decision.modelActual}</dd>
                    </div>
                  )}
                </dl>
              </details>
            </>
          ) : (
            <>
              <p className="dashboard__card-pending">
                Sin veredicto disponible.
              </p>
              <dl className="dashboard__card-data">
                <div>
                  <dt>Cédula</dt>
                  <dd data-testid="data-cedula">{intake?.cedula}</dd>
                </div>
                <div>
                  <dt>Ingresos</dt>
                  <dd data-testid="data-ingresos">USD {intake?.ingresos}</dd>
                </div>
                <div>
                  <dt>Monto</dt>
                  <dd data-testid="data-monto">USD {intake?.monto}</dd>
                </div>
                <div>
                  <dt>Plazo</dt>
                  <dd data-testid="data-plazo">{intake?.plazo} meses</dd>
                </div>
              </dl>
            </>
          )}
        </article>
      </div>
    </main>
  );
}

function humanizeSignal(signal: string): string {
  const map: Record<string, string> = {
    bureau_score: 'Bureau score',
    alt_score: 'Score alt.',
    iess_affiliation: 'Afiliación IESS',
    iess_tenure: 'Antigüedad',
    hard_inquiries: 'Consultas',
    age_band: 'Edad',
  };
  return map[signal] ?? signal;
}

function humanizeRawValue(signal: string, value: number | null): string {
  if (value === null) return 'n/d';
  switch (signal) {
    case 'bureau_score':
      return `${value} (${value >= 720 ? 'muy bueno' : value >= 600 ? 'bueno' : 'bajo'})`;
    case 'alt_score':
      return `${value}/100`;
    case 'iess_affiliation':
      return value === 1 ? 'Sí' : 'No';
    case 'iess_tenure':
      return `${(value / 12).toFixed(1)} años`;
    case 'hard_inquiries':
      return `${value}`;
    case 'age_band':
      return `${value} años`;
    default:
      return `${value}`;
  }
}
