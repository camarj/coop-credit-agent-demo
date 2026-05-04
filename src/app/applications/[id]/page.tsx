import { notFound } from 'next/navigation';
import { eq, asc } from 'drizzle-orm';
import { db } from '@/db/client';
import { applications, applicationStates } from '@/db/schema';

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

interface SagaContribution {
  __saga: {
    compensated: string[];
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

  const v3 = states.find(
    (s) => s.version === 3 && s.createdByAgent === 'bureau',
  );
  const bureauContribution = v3?.contribution as BureauContribution | undefined;
  const bureau = bureauContribution?.bureau;

  const sagaRow = states.find((s) => s.createdByAgent === 'orchestrator');
  const sagaContribution = sagaRow?.contribution as
    | SagaContribution
    | undefined;
  const saga = sagaContribution?.__saga;

  const latestVersion = states.length > 0 ? states[states.length - 1].version : null;
  const identityResolved = identity !== undefined;
  const incomeResolved = income !== undefined;
  const bureauResolved = bureau !== undefined;

  const leadCopy = (() => {
    if (saga) {
      return 'Solicitud terminada con saga ejecutada — los efectos colaterales fueron revertidos.';
    }
    if (bureauResolved) {
      return 'Pipeline de verificación completo: identidad, ingresos y bureau.';
    }
    if (incomeResolved) {
      return 'Identidad e ingresos verificados. Bureau pendiente.';
    }
    if (identityResolved) {
      return 'Identidad verificada. Ingresos pendientes — el agente de income no completó.';
    }
    return 'Identidad pendiente — el agente de identidad no completó.';
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
              {saga.compensated.join(', ')}
            </span>
            {' '}para revertir efectos colaterales.
          </p>
          <p className="text-[var(--fg-muted)] text-sm mt-1">
            Razón: <span data-testid="saga-reason">{saga.reason}</span>
          </p>
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
            {v3 && (
              <>
                <span>·</span>
                <span>{new Date(v3.createdAt).toISOString()}</span>
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
      </section>
    </main>
  );
}
