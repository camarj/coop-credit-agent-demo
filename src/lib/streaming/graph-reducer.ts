import { PIPELINE_NODES, type AgentName } from '@/lib/orchestrator/pipeline';
import type { StreamEvent } from '@/lib/streaming/event-schema';

export type NodeState = 'PENDING' | 'RUNNING' | 'COMPLETE' | 'FAILED' | 'COMPENSATED';

export type GraphNode = {
  state: NodeState;
  currentSpanId: string | null;
  events: Array<{ name: string; attrs: Record<string, unknown>; at: number }>;
  attributes: Record<string, unknown>;
};

export type GraphStatus = 'streaming' | 'complete' | 'failed';

export type GraphState = {
  status: GraphStatus;
  failureReason?: string;
  nodes: Record<AgentName, GraphNode>;
};

function emptyNode(): GraphNode {
  return { state: 'PENDING', currentSpanId: null, events: [], attributes: {} };
}

export function initialGraphState(): GraphState {
  const nodes = {} as Record<AgentName, GraphNode>;
  for (const name of PIPELINE_NODES) {
    nodes[name] = emptyNode();
  }
  return { status: 'streaming', nodes };
}

function setNode(state: GraphState, agent: AgentName, patch: Partial<GraphNode>): GraphState {
  return {
    ...state,
    nodes: {
      ...state.nodes,
      [agent]: { ...state.nodes[agent], ...patch },
    },
  };
}

export function reduce(prev: GraphState, event: StreamEvent): GraphState {
  switch (event.kind) {
    case 'span.start':
      return setNode(prev, event.agent, {
        state: 'RUNNING',
        currentSpanId: event.spanId,
      });

    case 'span.complete': {
      const node = prev.nodes[event.agent];
      if (node.state !== 'RUNNING') return prev;
      return setNode(prev, event.agent, { state: 'COMPLETE' });
    }

    case 'span.failed': {
      const node = prev.nodes[event.agent];
      if (node.state !== 'RUNNING') return prev;
      return setNode(prev, event.agent, {
        state: 'FAILED',
        attributes: { ...node.attributes, failureReason: event.reason },
      });
    }

    case 'span.compensated': {
      const node = prev.nodes[event.agent];
      if (node.state !== 'COMPLETE') return prev;
      return setNode(prev, event.agent, { state: 'COMPENSATED' });
    }

    case 'span.event': {
      const node = prev.nodes[event.agent];
      return setNode(prev, event.agent, {
        events: [...node.events, { name: event.name, attrs: event.attrs, at: event.at }],
      });
    }

    case 'span.attribute': {
      const node = prev.nodes[event.agent];
      return setNode(prev, event.agent, {
        attributes: { ...node.attributes, [event.key]: event.value },
      });
    }

    case 'orchestrator.complete':
    case 'already_complete':
      return { ...prev, status: 'complete' };

    case 'orchestrator.failed':
      return { ...prev, status: 'failed', failureReason: event.reason };
  }
}
