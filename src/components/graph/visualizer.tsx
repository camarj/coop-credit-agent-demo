import { PIPELINE_NODES, type AgentName } from '@/lib/orchestrator/pipeline';
import type { GraphState, NodeState } from '@/lib/streaming/graph-reducer';
import { NODE_LABELS, STATE_LABELS } from './labels';
import './visualizer.css';

// Vertical layout: top → bottom, parallel branch (bureau/alt_score) splits
// horizontally. Mobile-first — viewBox aspect ratio fits a 320×640 column.
const VIEWBOX_WIDTH = 320;
const VIEWBOX_HEIGHT = 720;

type Pos = { x: number; y: number };

const NODE_POSITIONS: Record<AgentName, Pos> = {
  identity: { x: 160, y: 80 },
  income: { x: 160, y: 200 },
  bureau: { x: 90, y: 340 },
  alt_score: { x: 230, y: 340 },
  policy: { x: 160, y: 480 },
  decision: { x: 160, y: 620 },
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
  // Vertical layout: edges flow top → bottom. When endpoints share x, draw
  // a straight vertical line. When they diverge (parallel branch), use a
  // Bezier that curves in x at the midpoint y.
  if (from.x === to.x) {
    return `M ${from.x} ${from.y + NODE_RADIUS} L ${to.x} ${to.y - NODE_RADIUS}`;
  }
  const midY = (from.y + to.y) / 2;
  return `M ${from.x} ${from.y + NODE_RADIUS} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y - NODE_RADIUS}`;
}

interface Props {
  state: GraphState;
  selectedAgent?: AgentName | null;
  onSelectAgent?: (agent: AgentName) => void;
}

export function GraphVisualizer({ state, selectedAgent = null, onSelectAgent }: Props) {
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
          const isSelected = selectedAgent === agent;
          const handleActivate = onSelectAgent
            ? () => onSelectAgent(agent)
            : undefined;
          return (
            <g
              key={agent}
              data-agent={agent}
              data-state={node.state}
              data-selected={isSelected || undefined}
              tabIndex={0}
              role="button"
              aria-label={`Agente ${NODE_LABELS[agent]} — ${STATE_LABELS[node.state]}`}
              onClick={handleActivate}
              onKeyDown={
                handleActivate
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleActivate();
                      }
                    }
                  : undefined
              }
            >
              <circle
                data-graph-focus-ring
                cx={pos.x}
                cy={pos.y}
                r={NODE_RADIUS + 4}
                fill="none"
                stroke="transparent"
                strokeWidth={2}
              />
              {node.state === 'RUNNING' && (
                <>
                  <circle
                    data-graph-running-ring="outer"
                    cx={pos.x}
                    cy={pos.y}
                    r={NODE_RADIUS}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth={2}
                  />
                  <circle
                    data-graph-running-ring="inner"
                    cx={pos.x}
                    cy={pos.y}
                    r={NODE_RADIUS}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth={2}
                  />
                </>
              )}
              {isSelected && (
                <circle
                  data-graph-selection-ring="true"
                  cx={pos.x}
                  cy={pos.y}
                  r={NODE_RADIUS + 8}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={2}
                />
              )}
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
                x={agent === 'bureau' ? pos.x - NODE_RADIUS - 12 : pos.x + NODE_RADIUS + 12}
                y={pos.y + 4}
                textAnchor={agent === 'bureau' ? 'end' : 'start'}
                fontFamily="var(--font-sans)"
                fontSize={14}
                fontWeight={500}
                fill="var(--fg)"
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
