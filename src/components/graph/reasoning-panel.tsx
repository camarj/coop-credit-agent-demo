import type { AgentName } from '@/lib/orchestrator/pipeline';
import type { GraphState } from '@/lib/streaming/graph-reducer';
import { NODE_LABELS, STATE_LABELS } from './labels';
import './reasoning-panel.css';

interface Props {
  selectedAgent: AgentName | null;
  state: GraphState;
  onClose: () => void;
}

function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function ReasoningPanel({ selectedAgent, state, onClose }: Props) {
  if (!selectedAgent) return null;
  const node = state.nodes[selectedAgent];
  const attributeEntries = Object.entries(node.attributes);
  const failureReason = typeof node.attributes.failureReason === 'string'
    ? node.attributes.failureReason
    : null;
  const visibleAttrs = attributeEntries.filter(([k]) => k !== 'failureReason');

  return (
    <aside
      role="dialog"
      aria-label={`Razonamiento del agente ${NODE_LABELS[selectedAgent]}`}
      data-testid="reasoning-panel"
      data-agent={selectedAgent}
      className="reasoning-panel"
    >
      <header className="reasoning-panel__header">
        <div>
          <span className="eyebrow reasoning-panel__eyebrow">RAZONAMIENTO</span>
          <h2 className="reasoning-panel__title">{NODE_LABELS[selectedAgent]}</h2>
          <span
            className="reasoning-panel__state"
            data-testid="reasoning-state"
            data-state={node.state}
          >
            {STATE_LABELS[node.state]}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar panel"
          className="reasoning-panel__close"
        >
          ×
        </button>
      </header>

      {failureReason && (
        <section
          className="reasoning-panel__failure"
          data-testid="reasoning-failure"
        >
          <span className="eyebrow">MOTIVO DEL FALLO</span>
          <p>{failureReason}</p>
        </section>
      )}

      <section
        className="reasoning-panel__section"
        data-testid="reasoning-attributes"
      >
        <h3 className="reasoning-panel__section-title">Atributos</h3>
        {visibleAttrs.length === 0 ? (
          <p className="reasoning-panel__empty">Sin atributos todavía.</p>
        ) : (
          <dl className="reasoning-panel__attrs">
            {visibleAttrs.map(([key, value]) => (
              <div key={key} className="reasoning-panel__attr-row">
                <dt>{key}</dt>
                <dd>{formatValue(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section
        className="reasoning-panel__section"
        data-testid="reasoning-events"
      >
        <h3 className="reasoning-panel__section-title">Eventos</h3>
        {node.events.length === 0 ? (
          <p className="reasoning-panel__empty">Sin eventos todavía.</p>
        ) : (
          <ol className="reasoning-panel__events">
            {node.events.map((evt, i) => (
              <li key={i} className="reasoning-panel__event">
                <span className="eyebrow">{evt.name}</span>
                {Object.keys(evt.attrs).length > 0 && (
                  <pre className="reasoning-panel__event-attrs">
                    {JSON.stringify(evt.attrs, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </aside>
  );
}
