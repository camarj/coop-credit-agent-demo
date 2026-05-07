'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useGraphStream } from './use-graph-stream';
import { GraphVisualizer } from './visualizer';
import { ReasoningStream } from './reasoning-stream';
import { PIPELINE_NODES, type AgentName } from '@/lib/orchestrator/pipeline';
import { NODE_LABELS } from './labels';
import type { GraphState } from '@/lib/streaming/graph-reducer';
import './live-view.css';

const COMPLETION_DWELL_MS = 700;

const LEAD_COPY: Record<AgentName | 'idle' | 'complete' | 'failed', string> = {
  identity: 'Verificando identidad contra el Registro Civil',
  income: 'Consultando afiliación IESS y calculando relación deuda/ingreso',
  bureau: 'Solicitando reporte crediticio en Equifax',
  alt_score: 'Construyendo score alternativo desde señales no-tradicionales',
  policy: 'Aplicando reglas de la política de la cooperativa',
  decision: 'Razonando la decisión final con explicabilidad',
  idle: 'Conectando con el orquestador',
  complete: 'Decisión lista — preparando reporte',
  failed: 'La solicitud no pudo completarse',
};

function findCurrentAgent(state: GraphState): AgentName | null {
  for (const agent of PIPELINE_NODES) {
    if (state.nodes[agent].state === 'RUNNING') return agent;
  }
  return null;
}

interface Props {
  applicationId: string;
}

export function LiveView({ applicationId }: Props) {
  const { state, status } = useGraphStream(applicationId);
  const router = useRouter();
  const currentAgent = findCurrentAgent(state);

  const leadKey: AgentName | 'idle' | 'complete' | 'failed' =
    status === 'complete'
      ? 'complete'
      : status === 'failed'
        ? 'failed'
        : (currentAgent ?? 'idle');

  useEffect(() => {
    if (status !== 'complete' && status !== 'failed') return;
    const timer = setTimeout(() => router.refresh(), COMPLETION_DWELL_MS);
    return () => clearTimeout(timer);
  }, [status, router]);

  const heading =
    currentAgent !== null
      ? NODE_LABELS[currentAgent]
      : status === 'complete'
        ? 'Análisis completado'
        : status === 'failed'
          ? 'Análisis interrumpido'
          : 'Procesando solicitud';

  return (
    <main
      className="live-view"
      data-testid="live-view"
      data-status={status}
      data-current-agent={currentAgent ?? undefined}
    >
      <header className="live-view__header">
        <div className="entry-meta">
          <span className="cat">ANALIZANDO SOLICITUD</span>
          <span>·</span>
          <span data-testid="application-id-short">
            {applicationId.slice(0, 8)}
          </span>
        </div>
        <h1 className="live-view__title" data-testid="live-view-heading">
          {heading}
        </h1>
        <p className="lead" data-testid="live-view-lead">
          {LEAD_COPY[leadKey]}
        </p>
        <hr className="hairline" />
      </header>

      <div className="live-view__body">
        <div className="live-view__graph">
          <GraphVisualizer state={state} />
        </div>
        <div className="live-view__feed">
          <ReasoningStream state={state} />
        </div>
      </div>

      {status === 'disconnected' && (
        <div
          className="live-view__error"
          data-testid="connection-error"
          role="status"
        >
          Conexión perdida — intentando reconectar.
        </div>
      )}
    </main>
  );
}
