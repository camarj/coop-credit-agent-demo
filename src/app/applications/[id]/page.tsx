import { notFound } from 'next/navigation';
import { eq, asc } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { db } from '@/db/client';
import { applications, applicationStates } from '@/db/schema';
import { parsePolicyCorpus } from '@/lib/rag/parser';
import type { PolicyChunk } from '@/lib/rag/types';

// Load and parse the policy corpus once at module load. Drives the rule-id
// → fullText lookup used by the v5 panel to render rule cards on demand.
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

interface PageProps {
  params: Promise<{ id: string }>;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface IntakeContribution {
  cedula: string;
  ingresos: number;
  monto: number;
  plazo: number;
}

interface IdentityContribution {
  identity: {
    name: string;
    birthDate: string;
    valid: boolean;
  };
}

interface IncomeContribution {
  income: {
    employer: string;
    salary: number;
    monthsActive: number;
  };
}

interface BureauContribution {
  bureau: {
    score: number;
    history: Array<{ at: number; source: string }>;
    hardInquiriesCount: number;
  };
}

interface AltScoreContribution {
  alt_score: {
    score: number;
    signals: string[];
  };
}

interface PolicyContribution {
  policy: {
    applies: string[];
    notes: string;
  };
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

export default async function ApplicationPage({ params }: PageProps) {
  const { id } = await params;

  if (!UUID_REGEX.test(id)) {
    notFound();
  }

  const [app] = await db
    .select()
    .from(applications)
    .where(eq(applications.id, id))
    .limit(1);

  if (!app) {
    notFound();
  }

  const states = await db
    .select()
    .from(applicationStates)
    .where(eq(applicationStates.applicationId, id))
    .orderBy(asc(applicationStates.version));

  const v0 = states.find((s) => s.version === 0);
  const intake = v0?.contribution as IntakeContribution | undefined;

  const v1 = states.find((s) => s.version === 1);
  const identityContribution = v1?.contribution as IdentityContribution | undefined;
  const identity = identityContribution?.identity;

  const v2 = states.find((s) => s.version === 2);
  const incomeContribution = v2?.contribution as IncomeContribution | undefined;
  const income = incomeContribution?.income;

  // Bureau and alt_score run in parallel from version 3 onward — array order
  // pre-assigns versions (bureau=3, alt_score=4). Filter by agent name, not
  // by version, so we stay agnostic to persistence wall-clock order.
  const bureauRow = states.find((s) => s.createdByAgent === 'bureau');
  const bureauContribution = bureauRow?.contribution as
    | BureauContribution
    | undefined;
  const bureau = bureauContribution?.bureau;

  const altScoreRow = states.find((s) => s.createdByAgent === 'alt_score');
  const altScoreContribution = altScoreRow?.contribution as
    | AltScoreContribution
    | undefined;
  const altScore = altScoreContribution?.alt_score;

  const policyRow = states.find((s) => s.createdByAgent === 'policy');
  const policyContribution = policyRow?.contribution as
    | PolicyContribution
    | undefined;
  const policy = policyContribution?.policy;

  const decisionRow = states.find((s) => s.createdByAgent === 'decision');
  const decisionContribution = decisionRow?.contribution as
    | DecisionContribution
    | undefined;
  const decision = decisionContribution?.decision;

  const sagaRow = states.find((s) => s.createdByAgent === 'orchestrator');
  const sagaContribution = sagaRow?.contribution as
    | SagaContribution
    | undefined;
  const saga = sagaContribution?.__saga;

  const latestVersion = states.length > 0 ? states[states.length - 1].version : null;
  const identityResolved = identity !== undefined;
  const incomeResolved = income !== undefined;
  const bureauResolved = bureau !== undefined;
  const altScoreResolved = altScore !== undefined;
  const policyResolved = policy !== undefined;

  const leadCopy = (() => {
    if (saga) {
      return 'Solicitud terminada con saga ejecutada — los efectos colaterales fueron revertidos.';
    }
    if (decision) {
      if (decision.decisionType === 'hard_reject') {
        const ruleId = decision.citedRules[0] ?? 'EXC-???';
        return `Solicitud rechazada por regla constitucional (${ruleId}). Auditoría disponible abajo.`;
      }
      if (decision.decision === 'APPROVED') {
        return 'Solicitud lista para aprobación con las condiciones citadas.';
      }
      return 'Solicitud requiere revisión humana. Lee el razonamiento abajo.';
    }
    if (policyResolved) {
      return 'Pipeline completo: identidad, ingresos, bureau, score alternativo y política aplicada. Decisión pendiente.';
    }
    if (bureauResolved && altScoreResolved) {
      return 'Identidad, ingresos, bureau y score alternativo listos. Política pendiente.';
    }
    if (bureauResolved || altScoreResolved) {
      return 'Identidad e ingresos verificados. Una de las dos ramas paralelas (bureau / score alternativo) no completó.';
    }
    if (incomeResolved) {
      return 'Identidad e ingresos verificados. Bureau y score alternativo pendientes.';
    }
    if (identityResolved) {
      return 'Identidad verificada. Ingresos pendientes — el agente de income no completó.';
    }
    return 'Identidad pendiente — el agente de identidad no completó.';
  })();

  // Decision UI tokens — tokens warm/terrosos del design system v2 (ver
  // .claude/rules/inteliside-design-light.md). NO hardcodear hex en JSX.
  const decisionStyle = (() => {
    if (!decision) return null;
    if (decision.decision === 'APPROVED') {
      return {
        bg: 'bg-[#EAF4F5]',
        border: 'border-[#1F6F78]',
        textAccent: 'text-[#1F6F78]',
        label: '',
        cat: 'APROBADA',
      };
    }
    if (decision.decision === 'REJECTED') {
      return {
        bg: 'bg-[#F2E0DC]',
        border: 'border-[#B64545]',
        textAccent: 'text-[#B64545]',
        label: 'NOTIFICAR AL CLIENTE',
        cat: 'RECHAZO AUTOMATICO',
      };
    }
    return {
      bg: 'bg-[#F5EFE0]',
      border: 'border-[#C67E2F]',
      textAccent: 'text-[#C67E2F]',
      label: 'ESCALADA A HUMANO',
      cat: 'EN REVISION',
    };
  })();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 md:py-24">
      <header>
        <div className="entry-meta">
          <span className="cat">SOLICITUD</span>
          <span>·</span>
          <span data-testid="application-id">{app.id}</span>
          <span>·</span>
          <span data-testid="latest-version">
            v{latestVersion ?? '?'}
          </span>
        </div>
        <h1>Solicitud recibida</h1>
        <p className="lead">{leadCopy}</p>
        <hr className="hairline" />
      </header>

      {saga && (
        <aside
          className="mt-10 border-l-2 border-[var(--accent)] bg-[var(--accent-wash)] px-6 py-4"
          data-testid="saga-banner"
        >
          <div className="entry-meta mb-2">
            <span className="cat">SAGA</span>
            <span>·</span>
            <span>{new Date(saga.completedAt).toISOString()}</span>
          </div>
          <p className="text-[var(--fg)]">
            Solicitud abortada. El orquestador compensó{' '}
            <span data-testid="saga-compensated">
              {saga.compensatedAgents.join(', ')}
            </span>
            {' '}para revertir efectos colaterales.
          </p>
          <p className="text-[var(--fg-muted)] text-sm mt-1">
            Razón: <span data-testid="saga-reason">{saga.reason}</span>
          </p>
        </aside>
      )}

      {decision && decisionStyle && (
        <aside
          className={`mt-10 border-l-4 ${decisionStyle.border} ${decisionStyle.bg} px-6 py-5`}
          data-testid="decision-banner"
          data-decision={decision.decision}
          data-decision-type={decision.decisionType}
        >
          <div className="entry-meta mb-3">
            <span className={`cat ${decisionStyle.textAccent}`}>
              DECISION SUGERIDA
            </span>
            <span>·</span>
            <span data-testid="decision-cat">{decisionStyle.cat}</span>
            {decisionStyle.label && (
              <>
                <span>·</span>
                <span
                  data-testid="decision-action-label"
                  className="font-mono text-[10px] tracking-[0.1em]"
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
                  className="font-mono text-[10px] tracking-[0.1em] text-[#C67E2F]"
                >
                  MODO DEGRADADO
                </span>
              </>
            )}
          </div>
          <h2 className={`text-3xl font-serif ${decisionStyle.textAccent}`}>
            {decision.decision === 'APPROVED'
              ? 'Aprobada'
              : decision.decision === 'REJECTED'
                ? 'Rechazada'
                : 'En revisión'}
          </h2>
          <p
            className="mt-3 text-[var(--fg-muted)] text-sm"
            data-testid="decision-confidence-meta"
          >
            Confianza{' '}
            <span data-testid="decision-confidence">
              {(decision.confidence * 100).toFixed(1)}%
            </span>{' '}
            ·{' '}
            <span data-testid="decision-cited-rules-count">
              {decision.citedRules.length}
            </span>{' '}
            {decision.citedRules.length === 1 ? 'regla citada' : 'reglas citadas'}
          </p>
          <p
            className="mt-4 text-[var(--fg)] serif-italic"
            data-testid="decision-reason-banner"
          >
            {decision.reason}
          </p>
          {decision.citedRules.length > 0 && (
            <div
              className="mt-4 flex flex-wrap gap-2"
              data-testid="decision-cited-rules-banner"
            >
              {decision.citedRules.map((ruleId) => (
                <a
                  key={ruleId}
                  href={`#policy-rule-${ruleId}`}
                  data-testid={`decision-rule-link-${ruleId}`}
                  className="font-mono text-[11px] uppercase tracking-[0.08em] bg-[var(--accent-wash)] text-[var(--accent)] px-2 py-1 rounded-[2px] hover:underline"
                >
                  {ruleId}
                </a>
              ))}
            </div>
          )}
        </aside>
      )}

      <section
        className="mt-12 space-y-12"
        data-testid="states-section"
      >
        <article data-testid="state-v0">
          <div className="entry-meta mb-4">
            <span className="cat">v0</span>
            <span>·</span>
            <span>INTAKE</span>
            {v0 && (
              <>
                <span>·</span>
                <span>{new Date(v0.createdAt).toISOString()}</span>
              </>
            )}
          </div>
          <h3 className="mb-4">Datos del solicitante</h3>
          <dl className="grid grid-cols-2 gap-y-3 gap-x-8 text-[var(--fg)]">
            <dt className="text-[var(--fg-muted)]">Cédula</dt>
            <dd data-testid="data-cedula">{intake?.cedula}</dd>

            <dt className="text-[var(--fg-muted)]">Ingresos mensuales</dt>
            <dd data-testid="data-ingresos">USD {intake?.ingresos}</dd>

            <dt className="text-[var(--fg-muted)]">Monto solicitado</dt>
            <dd data-testid="data-monto">USD {intake?.monto}</dd>

            <dt className="text-[var(--fg-muted)]">Plazo</dt>
            <dd data-testid="data-plazo">{intake?.plazo} meses</dd>
          </dl>
        </article>

        <hr className="hairline" />

        <article data-testid="state-v1">
          <div className="entry-meta mb-4">
            <span className="cat">v1</span>
            <span>·</span>
            <span>IDENTITY</span>
            {v1 && (
              <>
                <span>·</span>
                <span>{new Date(v1.createdAt).toISOString()}</span>
              </>
            )}
          </div>
          <h3 className="mb-4">Identidad</h3>
          {identity ? (
            <dl className="grid grid-cols-2 gap-y-3 gap-x-8 text-[var(--fg)]">
              <dt className="text-[var(--fg-muted)]">Nombre</dt>
              <dd data-testid="identity-name">{identity.name}</dd>

              <dt className="text-[var(--fg-muted)]">Fecha de nacimiento</dt>
              <dd data-testid="identity-birthdate">{identity.birthDate}</dd>

              <dt className="text-[var(--fg-muted)]">Estado</dt>
              <dd data-testid="identity-valid">
                {identity.valid ? 'Válida' : 'Persona fallecida'}
              </dd>
            </dl>
          ) : (
            <p
              className="text-[var(--fg-muted)]"
              data-testid="identity-pending"
            >
              Pendiente. La cédula no se pudo verificar contra Registro Civil
              en este intento.
            </p>
          )}
        </article>

        <hr className="hairline" />

        <article data-testid="state-v2">
          <div className="entry-meta mb-4">
            <span className="cat">v2</span>
            <span>·</span>
            <span>INCOME</span>
            {v2 && (
              <>
                <span>·</span>
                <span>{new Date(v2.createdAt).toISOString()}</span>
              </>
            )}
          </div>
          <h3 className="mb-4">Ingresos verificados</h3>
          {income ? (
            <dl className="grid grid-cols-2 gap-y-3 gap-x-8 text-[var(--fg)]">
              <dt className="text-[var(--fg-muted)]">Empleador</dt>
              <dd data-testid="income-employer">{income.employer}</dd>

              <dt className="text-[var(--fg-muted)]">Sueldo IESS (USD)</dt>
              <dd data-testid="income-salary">USD {income.salary}</dd>

              <dt className="text-[var(--fg-muted)]">Antigüedad</dt>
              <dd data-testid="income-months-active">
                {income.monthsActive} meses
              </dd>
            </dl>
          ) : (
            <p
              className="text-[var(--fg-muted)]"
              data-testid="income-pending"
            >
              Pendiente. El IESS no devolvió afiliación activa para esta
              cédula en este intento.
            </p>
          )}
        </article>

        <hr className="hairline" />

        <article data-testid="state-v3">
          <div className="entry-meta mb-4">
            <span className="cat">v3</span>
            <span>·</span>
            <span>BUREAU</span>
            {bureauRow && (
              <>
                <span>·</span>
                <span>{new Date(bureauRow.createdAt).toISOString()}</span>
              </>
            )}
          </div>
          <h3 className="mb-4">Reporte crediticio</h3>
          {bureau ? (
            <dl className="grid grid-cols-2 gap-y-3 gap-x-8 text-[var(--fg)]">
              <dt className="text-[var(--fg-muted)]">Score</dt>
              <dd data-testid="bureau-score">{bureau.score}</dd>

              <dt className="text-[var(--fg-muted)]">Hard inquiries</dt>
              <dd data-testid="bureau-hard-inquiries">
                {bureau.hardInquiriesCount}
              </dd>

              <dt className="text-[var(--fg-muted)]">Historial</dt>
              <dd>{bureau.history.length} registros</dd>
            </dl>
          ) : (
            <p
              className="text-[var(--fg-muted)]"
              data-testid="bureau-pending"
            >
              Pendiente. El bureau de crédito no devolvió un reporte para esta
              solicitud.
            </p>
          )}
        </article>

        <hr className="hairline" />

        <article data-testid="state-v4">
          <div className="entry-meta mb-4">
            <span className="cat">v4</span>
            <span>·</span>
            <span>ALT_SCORE</span>
            {altScoreRow && (
              <>
                <span>·</span>
                <span>{new Date(altScoreRow.createdAt).toISOString()}</span>
              </>
            )}
          </div>
          <h3 className="mb-4">Score alternativo</h3>
          {altScore ? (
            <dl className="grid grid-cols-2 gap-y-3 gap-x-8 text-[var(--fg)]">
              <dt className="text-[var(--fg-muted)]">Score sintético</dt>
              <dd data-testid="alt-score-value">{altScore.score} / 100</dd>

              <dt className="text-[var(--fg-muted)]">Señales</dt>
              <dd
                data-testid="alt-score-signals"
                className="flex flex-wrap gap-2"
              >
                {altScore.signals.map((signal) => (
                  <span
                    key={signal}
                    className="font-mono text-[11px] uppercase tracking-[0.08em] bg-[var(--accent-wash)] text-[var(--accent)] px-2 py-1 rounded-[2px]"
                  >
                    {signal}
                  </span>
                ))}
              </dd>
            </dl>
          ) : (
            <p
              className="text-[var(--fg-muted)]"
              data-testid="alt-score-pending"
            >
              Pendiente. La fuente de datos alternativos no cubrió a este
              solicitante en este intento.
            </p>
          )}
        </article>

        <hr className="hairline" />

        <article data-testid="state-v5">
          <div className="entry-meta mb-4">
            <span className="cat">v5</span>
            <span>·</span>
            <span>POLICY</span>
            {policyRow && (
              <>
                <span>·</span>
                <span>{new Date(policyRow.createdAt).toISOString()}</span>
              </>
            )}
          </div>
          <h3 className="mb-4" data-testid="policy-heading">
            Política aplicada
          </h3>
          {policy ? (
            <div className="space-y-6 text-[var(--fg)]">
              <div>
                <dt className="text-[var(--fg-muted)] mb-2">
                  Reglas aplicables
                </dt>
                {policy.applies.length > 0 ? (
                  <dd
                    data-testid="policy-applies"
                    className="flex flex-wrap gap-2"
                  >
                    {policy.applies.map((ruleId) => (
                      <span
                        key={ruleId}
                        data-testid={`policy-rule-${ruleId}`}
                        className="font-mono text-[11px] uppercase tracking-[0.08em] bg-[var(--accent-wash)] text-[var(--accent)] px-2 py-1 rounded-[2px]"
                      >
                        {ruleId}
                      </span>
                    ))}
                  </dd>
                ) : (
                  <dd
                    data-testid="policy-applies-empty"
                    className="text-[var(--fg-muted)] italic"
                  >
                    Ninguna regla del manual aplica claramente a este perfil.
                  </dd>
                )}
              </div>

              <div>
                <dt className="text-[var(--fg-muted)] mb-2">
                  Razonamiento del modelo
                </dt>
                <dd
                  data-testid="policy-notes"
                  className="serif-italic text-[var(--fg-muted)]"
                >
                  {policy.notes}
                </dd>
              </div>

              {policy.applies.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[var(--fg-muted)] text-sm hover:text-[var(--accent)]">
                    Ver el texto completo de cada regla aplicada
                  </summary>
                  <div className="mt-4 space-y-6 border-l-2 border-[var(--rule)] pl-4">
                    {policy.applies.map((ruleId) => {
                      const chunk = policyChunksByRuleId.get(ruleId);
                      return (
                        <div
                          key={ruleId}
                          id={`policy-rule-${ruleId}`}
                          data-testid={`policy-rule-detail-${ruleId}`}
                        >
                          {chunk ? (
                            <pre className="whitespace-pre-wrap font-sans text-sm text-[var(--fg)]">
                              {chunk.fullText}
                            </pre>
                          ) : (
                            <p className="text-[var(--fg-subtle)] text-sm">
                              Regla {ruleId} citada por el modelo pero no
                              encontrada en el corpus actual.
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}
            </div>
          ) : (
            <p
              className="text-[var(--fg-muted)]"
              data-testid="policy-pending"
            >
              Pendiente. La evaluación de política no se completó para esta
              solicitud.
            </p>
          )}
        </article>

        <hr className="hairline" />

        <article data-testid="state-v6">
          <div className="entry-meta mb-4">
            <span className="cat">v6</span>
            <span>·</span>
            <span>DECISION</span>
            {decisionRow && (
              <>
                <span>·</span>
                <span>{new Date(decisionRow.createdAt).toISOString()}</span>
              </>
            )}
          </div>
          <h3 className="mb-4" data-testid="decision-heading">
            Veredicto y trazabilidad
          </h3>
          {decision ? (
            <div className="space-y-8 text-[var(--fg)]">
              {decision.degraded && (
                <div
                  data-testid="decision-degraded-disclaimer"
                  className="border-l-2 border-[#C67E2F] bg-[#F5EFE0] px-4 py-3 text-sm text-[var(--fg-muted)]"
                >
                  Esta decisión se calculó en modo degradado. Razón:{' '}
                  <span data-testid="decision-degraded-reason">
                    {decision.modelRequested && decision.modelActual
                      ? `${decision.modelRequested} → ${decision.modelActual}`
                      : 'fallback a razonamiento canned'}
                  </span>
                  . El razonamiento textual puede tener menos calidad narrativa;
                  los números deterministas se preservan.
                </div>
              )}

              <div>
                <dt className="text-[var(--fg-muted)] mb-2">Veredicto</dt>
                <dd className="text-[var(--fg)]" data-testid="decision-summary">
                  <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--fg-muted)]">
                    {decision.decisionType === 'hard_reject'
                      ? 'hard_reject (deterministic)'
                      : 'llm_decision'}
                  </span>{' '}
                  · confidence{' '}
                  <span data-testid="decision-confidence-detailed">
                    {(decision.confidence * 100).toFixed(1)}%
                  </span>
                </dd>
              </div>

              <div>
                <dt className="text-[var(--fg-muted)] mb-2">
                  Razonamiento del modelo
                </dt>
                <dd
                  className="serif-italic text-[var(--fg-muted)]"
                  data-testid="decision-reason-detailed"
                >
                  {decision.reason}
                </dd>
              </div>

              {decision.decisionType === 'hard_reject' &&
                decision.triggeredBy && (
                  <div>
                    <dt className="text-[var(--fg-muted)] mb-2">
                      Audit trail del rechazo
                    </dt>
                    <dl
                      className="grid grid-cols-[max-content_1fr] gap-y-2 gap-x-4 text-sm"
                      data-testid="decision-triggered-by"
                    >
                      <dt className="text-[var(--fg-muted)]">Regla disparada</dt>
                      <dd className="font-mono">
                        {decision.citedRules[0] ?? 'EXC-???'}
                      </dd>
                      <dt className="text-[var(--fg-muted)]">Campo</dt>
                      <dd className="font-mono">{decision.triggeredBy.field}</dd>
                      <dt className="text-[var(--fg-muted)]">Fuente</dt>
                      <dd className="font-mono">
                        {decision.triggeredBy.source}
                      </dd>
                      <dt className="text-[var(--fg-muted)]">Valor crudo</dt>
                      <dd className="font-mono">
                        {String(decision.triggeredBy.value)}
                      </dd>
                      {decision.triggeredBy.computed && (
                        <>
                          <dt className="text-[var(--fg-muted)]">
                            Cálculo derivado
                          </dt>
                          <dd className="font-mono text-xs">
                            {JSON.stringify(decision.triggeredBy.computed)}
                          </dd>
                        </>
                      )}
                      <dt className="text-[var(--fg-muted)]">LLM consultado</dt>
                      <dd>NO (bypass por hard reject)</dd>
                    </dl>
                  </div>
                )}

              {decision.decisionType === 'llm_decision' && decision.breakdown && (
                <div>
                  <dt className="text-[var(--fg-muted)] mb-2">
                    Cómo se calculó la confianza
                  </dt>
                  <table
                    className="w-full text-sm"
                    data-testid="decision-breakdown-table"
                  >
                    <thead>
                      <tr className="text-left text-[var(--fg-muted)] border-b border-[var(--rule)]">
                        <th className="py-2 font-normal">Señal</th>
                        <th className="py-2 font-normal">Valor</th>
                        <th className="py-2 font-normal text-right">Aporta</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-[13px]">
                      {decision.breakdown.map((row) => (
                        <tr
                          key={row.signal}
                          className="border-b border-[var(--rule-soft)]"
                          data-testid={`breakdown-row-${row.signal}`}
                        >
                          <td className="py-2">
                            {humanizeSignal(row.signal)}
                          </td>
                          <td className="py-2">
                            {humanizeRawValue(row.signal, row.rawValue)}
                          </td>
                          <td className="py-2 text-right">
                            {(row.weighted * 100).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                      <tr className="font-bold">
                        <td className="py-2">Confianza total</td>
                        <td></td>
                        <td className="py-2 text-right">
                          {(decision.confidence * 100).toFixed(1)}%
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="text-[var(--fg-muted)] text-xs mt-2">
                    Umbral aprobación: 70.0% · margen{' '}
                    {decision.confidence >= 0.7 ? '+' : ''}
                    {((decision.confidence - 0.7) * 100).toFixed(1)} pts
                  </p>
                </div>
              )}

              <details
                className="mt-2"
                data-testid="decision-telemetry-details"
              >
                <summary className="cursor-pointer text-[var(--fg-muted)] text-sm hover:text-[var(--accent)]">
                  Ver detalle telemétrico
                </summary>
                <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-y-1 gap-x-4 text-xs font-mono text-[var(--fg-muted)]">
                  {decision.modelRequested && (
                    <>
                      <dt>modelo solicitado</dt>
                      <dd>{decision.modelRequested}</dd>
                    </>
                  )}
                  {decision.modelActual && (
                    <>
                      <dt>modelo usado</dt>
                      <dd>{decision.modelActual}</dd>
                    </>
                  )}
                  <dt>llm bypassed</dt>
                  <dd>{decision.llmBypassed ? 'sí' : 'no'}</dd>
                  <dt>degraded</dt>
                  <dd>{decision.degraded ? 'sí' : 'no'}</dd>
                </dl>
              </details>
            </div>
          ) : (
            <p
              className="text-[var(--fg-muted)]"
              data-testid="decision-pending"
            >
              Pendiente. La decisión sugerida no se completó para esta
              solicitud.
            </p>
          )}
        </article>
      </section>
    </main>
  );
}

function humanizeSignal(signal: string): string {
  const map: Record<string, string> = {
    bureau_score: 'Bureau score',
    alt_score: 'Score alternativo',
    iess_affiliation: 'Afiliación IESS',
    iess_tenure: 'Antigüedad laboral',
    hard_inquiries: 'Consultas recientes',
    age_band: 'Edad',
  };
  return map[signal] ?? signal;
}

function humanizeRawValue(signal: string, value: number | null): string {
  if (value === null) return 'no disponible';
  switch (signal) {
    case 'bureau_score':
      return `${value} (${value >= 720 ? 'muy bueno' : value >= 600 ? 'bueno' : 'bajo'})`;
    case 'alt_score':
      return `${value}/100`;
    case 'iess_affiliation':
      return value === 1 ? 'Sí (formal)' : 'No (autónomo)';
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
