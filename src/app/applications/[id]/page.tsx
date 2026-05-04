import { notFound } from 'next/navigation';
import { eq, asc } from 'drizzle-orm';
import { db } from '@/db/client';
import { applications, applicationStates } from '@/db/schema';

interface PageProps {
  params: Promise<{ id: string }>;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const v0 = states[0];
  const data = v0?.data as {
    cedula: string;
    ingresos: number;
    monto: number;
    plazo: number;
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 md:py-24">
      <header>
        <div className="entry-meta">
          <span className="cat">SOLICITUD</span>
          <span>·</span>
          <span data-testid="application-id">{app.id}</span>
          <span>·</span>
          <span data-testid="latest-version">v{v0?.version ?? '?'}</span>
        </div>
        <h1>Solicitud recibida</h1>
        <p className="lead">
          La solicitud quedó registrada. En slices siguientes los agentes la
          procesarán.
        </p>
        <hr className="hairline" />
      </header>

      <section className="mt-12 space-y-8">
        <article>
          <h3 className="eyebrow mb-4">Datos del solicitante</h3>
          <dl className="grid grid-cols-2 gap-y-3 gap-x-8 text-[var(--fg)]">
            <dt className="text-[var(--fg-muted)]">Cédula</dt>
            <dd data-testid="data-cedula">{data?.cedula}</dd>

            <dt className="text-[var(--fg-muted)]">Ingresos mensuales</dt>
            <dd data-testid="data-ingresos">USD {data?.ingresos}</dd>

            <dt className="text-[var(--fg-muted)]">Monto solicitado</dt>
            <dd data-testid="data-monto">USD {data?.monto}</dd>

            <dt className="text-[var(--fg-muted)]">Plazo</dt>
            <dd data-testid="data-plazo">{data?.plazo} meses</dd>
          </dl>
        </article>

        <article>
          <h3 className="eyebrow mb-4">Historial de estados</h3>
          <ul className="space-y-2">
            {states.map((s) => (
              <li key={s.id} className="flex items-baseline gap-3">
                <span className="font-mono text-xs uppercase tracking-wider text-[var(--fg-subtle)]">
                  v{s.version}
                </span>
                <span>{s.createdByAgent}</span>
                <span className="text-[var(--fg-subtle)] text-sm">
                  {new Date(s.createdAt).toISOString()}
                </span>
              </li>
            ))}
          </ul>
        </article>
      </section>
    </main>
  );
}
