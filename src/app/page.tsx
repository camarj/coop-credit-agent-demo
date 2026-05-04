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
        <p>
          Este demo ilustra cómo construir un agente de IA confiable para
          industrias reguladas: orchestrator central, estado inmutable
          versionado, contratos en frontera con Zod, circuit breakers en cada
          llamada externa y compensación tipo saga ante fallos.
        </p>
        <p className="mt-6 text-[var(--fg-muted)]">
          Slice 1 — bootstrap completo. El form de solicitud y el
          procesamiento de la primera <span className="serif-italic">solicitud</span>{' '}
          llegan en el siguiente commit, después del primer test rojo.
        </p>
      </section>
    </main>
  );
}
