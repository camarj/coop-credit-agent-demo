import { ApplicationForm } from '@/components/application-form';

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 md:py-24">
      <header>
        <div className="entry-meta">
          <span className="cat">DEMO</span>
          <span>·</span>
          <span>COOPERATIVA AHORRO Y CREDITO</span>
        </div>
        <h1>coop-credit-agent</h1>
        <p className="lead">
          Decisión sugerida de microcrédito con arquitectura multi-agente apta
          para producción.
        </p>
        <hr className="hairline" />
      </header>

      <section className="mt-12">
        <h2 className="mb-2">Nueva solicitud</h2>
        <p className="mb-8 text-[var(--fg-muted)]">
          Ingresá los datos del solicitante. Esta slice solo persiste la
          solicitud — el procesamiento por agentes llega en slices siguientes.
        </p>
        <ApplicationForm />
      </section>
    </main>
  );
}
