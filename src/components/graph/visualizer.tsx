import { PIPELINE_NODES, type AgentName } from '@/lib/orchestrator/pipeline';
import type { GraphState, NodeState } from '@/lib/streaming/graph-reducer';

const VIEWBOX_WIDTH = 800;
const VIEWBOX_HEIGHT = 280;

type Pos = { x: number; y: number };

const NODE_POSITIONS: Record<AgentName, Pos> = {
  identity: { x: 80, y: 140 },
  income: { x: 220, y: 140 },
  bureau: { x: 380, y: 80 },
  alt_score: { x: 380, y: 200 },
  policy: { x: 540, y: 140 },
  decision: { x: 700, y: 140 },
};

const NODE_LABELS: Record<AgentName, string> = {
  identity: 'Identidad',
  income: 'Ingresos',
  bureau: 'Buró',
  alt_score: 'Score Alt.',
  policy: 'Política',
  decision: 'Decisión',
};

const EDGES: Array<[AgentName, AgentName]> = [
  ['identity', 'income'],
  ['income', 'bureau'],
  ['income', 'alt_score'],
  ['bureau', 'policy'],
  ['alt_score', 'policy'],
  ['policy', 'decision'],
];

const NODE_RADIUS = 26;

type StateStyle = {
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
};

const STATE_STYLES: Record<NodeState, StateStyle> = {
  PENDING: { fill: 'var(--bg-elevated)', stroke: 'var(--rule)', strokeWidth: 1 },
  RUNNING: { fill: 'var(--accent-wash)', stroke: 'var(--accent)', strokeWidth: 2 },
  COMPLETE: { fill: 'var(--bg-elevated)', stroke: 'var(--accent)', strokeWidth: 1.5 },
  FAILED: { fill: '#F2E0DC', stroke: '#B64545', strokeWidth: 2 },
  COMPENSATED: {
    fill: '#F5EFE0',
    stroke: '#C67E2F',
    strokeWidth: 2,
    strokeDasharray: '4 3',
  },
};

function edgePath(from: Pos, to: Pos): string {
  if (from.y === to.y) {
    return `M ${from.x + NODE_RADIUS} ${from.y} L ${to.x - NODE_RADIUS} ${to.y}`;
  }
  const midX = (from.x + to.x) / 2;
  return `M ${from.x + NODE_RADIUS} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x - NODE_RADIUS} ${to.y}`;
}

interface Props {
  state: GraphState;
}

export function GraphVisualizer({ state }: Props) {
  return (
    <svg
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      width="100%"
      style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
      role="img"
      aria-label="Pipeline de agentes"
      data-testid="graph-visualizer"
    >
      <g data-layer="edges">
        {EDGES.map(([from, to]) => (
          <path
            key={`${from}-${to}`}
            data-edge={`${from}-${to}`}
            d={edgePath(NODE_POSITIONS[from], NODE_POSITIONS[to])}
            fill="none"
            stroke="var(--rule)"
            strokeWidth={1}
          />
        ))}
      </g>
      <g data-layer="nodes">
        {PIPELINE_NODES.map((agent) => {
          const node = state.nodes[agent];
          const pos = NODE_POSITIONS[agent];
          const style = STATE_STYLES[node.state];
          return (
            <g key={agent} data-agent={agent} data-state={node.state}>
              <circle
                data-agent={agent}
                cx={pos.x}
                cy={pos.y}
                r={NODE_RADIUS}
                fill={style.fill}
                stroke={style.stroke}
                strokeWidth={style.strokeWidth}
                strokeDasharray={style.strokeDasharray}
              />
              <text
                x={pos.x}
                y={pos.y + NODE_RADIUS + 18}
                textAnchor="middle"
                fontFamily="var(--font-sans)"
                fontSize={13}
                fill="var(--fg-muted)"
              >
                {NODE_LABELS[agent]}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
