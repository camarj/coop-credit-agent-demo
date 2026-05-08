import type { AgentName } from '@/lib/orchestrator/pipeline';
import type { NodeState } from '@/lib/streaming/graph-reducer';

export const NODE_LABELS: Record<AgentName, string> = {
  identity: 'Identidad',
  income: 'Ingresos',
  bureau: 'Buró',
  alt_score: 'Score Alt.',
  policy: 'Política',
  decision: 'Decisión',
};

export const STATE_LABELS: Record<NodeState, string> = {
  PENDING: 'pendiente',
  RUNNING: 'ejecutando',
  COMPLETE: 'completado',
  FAILED: 'fallado',
  COMPENSATED: 'compensado',
};
