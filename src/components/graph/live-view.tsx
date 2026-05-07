'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useGraphStream } from './use-graph-stream';
import { GraphVisualizer } from './visualizer';
import { ReasoningPanel } from './reasoning-panel';
import type { AgentName } from '@/lib/orchestrator/pipeline';
import './live-view.css';

const COMPLETION_DWELL_MS = 700;

interface Props {
  applicationId: string;
}

export function LiveView({ applicationId }: Props) {
  const { state, status } = useGraphStream(applicationId);
  const [selectedAgent, setSelectedAgent] = useState<AgentName | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!selectedAgent) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedAgent(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedAgent]);

  useEffect(() => {
    if (status !== 'complete' && status !== 'failed') return;
    const timer = setTimeout(() => router.refresh(), COMPLETION_DWELL_MS);
    return () => clearTimeout(timer);
  }, [status, router]);

  return (
    <div className="live-view" data-testid="live-view" data-status={status}>
      <div className="live-view__graph">
        <GraphVisualizer
          state={state}
          selectedAgent={selectedAgent}
          onSelectAgent={setSelectedAgent}
        />
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
      <ReasoningPanel
        selectedAgent={selectedAgent}
        state={state}
        onClose={() => setSelectedAgent(null)}
      />
    </div>
  );
}
