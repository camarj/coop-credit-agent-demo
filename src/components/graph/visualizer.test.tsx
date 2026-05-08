import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GraphVisualizer } from '@/components/graph/visualizer';
import {
  initialGraphState,
  reduce,
  type GraphState,
} from '@/lib/streaming/graph-reducer';
import type { StreamEvent } from '@/lib/streaming/event-schema';
import { PIPELINE_NODES } from '@/lib/orchestrator/pipeline';

const T = 1730000000000;

function renderGraph(state: GraphState = initialGraphState()): string {
  return renderToStaticMarkup(<GraphVisualizer state={state} />);
}

function play(events: StreamEvent[]): GraphState {
  return events.reduce(reduce, initialGraphState());
}

describe('<GraphVisualizer> — initial render', () => {
  it('renders a single root <svg>', () => {
    const html = renderGraph();
    expect(html.match(/<svg /g) ?? []).toHaveLength(1);
  });

  it('renders one node per PIPELINE_NODES entry', () => {
    const html = renderGraph();
    for (const agent of PIPELINE_NODES) {
      expect(html).toContain(`data-agent="${agent}"`);
    }
  });

  it('marks every node as PENDING in the initial state', () => {
    const html = renderGraph();
    const pendingMatches = html.match(/data-state="PENDING"/g) ?? [];
    expect(pendingMatches).toHaveLength(PIPELINE_NODES.length);
  });

  it('renders Spanish labels per agent', () => {
    const html = renderGraph();
    expect(html).toContain('Identidad');
    expect(html).toContain('Ingresos');
    expect(html).toContain('Buró');
    expect(html).toContain('Score Alt.');
    expect(html).toContain('Política');
    expect(html).toContain('Decisión');
  });
});

describe('<GraphVisualizer> — state → visual mapping (ADR-0009 table)', () => {
  it('switches data-state to RUNNING when a span.start is reduced', () => {
    const state = play([
      { kind: 'span.start', version: 1, spanId: 'sp_1', agent: 'identity', at: T },
    ]);
    const html = renderGraph(state);
    expect(html).toMatch(/data-agent="identity"[^>]*data-state="RUNNING"/);
  });

  it('switches data-state to COMPLETE on span.complete', () => {
    const state = play([
      { kind: 'span.start', version: 1, spanId: 'sp_1', agent: 'identity', at: T },
      { kind: 'span.complete', version: 1, spanId: 'sp_1', agent: 'identity', at: T },
    ]);
    const html = renderGraph(state);
    expect(html).toMatch(/data-agent="identity"[^>]*data-state="COMPLETE"/);
  });

  it('keeps non-running nodes at PENDING when one node is RUNNING', () => {
    const state = play([
      { kind: 'span.start', version: 1, spanId: 'sp_1', agent: 'identity', at: T },
    ]);
    const html = renderGraph(state);
    const pending = html.match(/data-state="PENDING"/g) ?? [];
    expect(pending).toHaveLength(PIPELINE_NODES.length - 1);
  });
});

describe('<GraphVisualizer> — FAILED and COMPENSATED states', () => {
  it('renders FAILED with the danger red stroke (#B64545)', () => {
    const state = play([
      { kind: 'span.start', version: 1, spanId: 'sp_1', agent: 'bureau', at: T },
      { kind: 'span.failed', version: 1, spanId: 'sp_1', agent: 'bureau', reason: 'boom', at: T },
    ]);
    const html = renderGraph(state);
    expect(html).toMatch(/data-agent="bureau"[^>]*stroke="#B64545"/);
  });

  it('renders COMPENSATED with the warm warning stroke (#C67E2F) and dashed pattern', () => {
    const state = play([
      { kind: 'span.start', version: 1, spanId: 'sp_1', agent: 'bureau', at: T },
      { kind: 'span.complete', version: 1, spanId: 'sp_1', agent: 'bureau', at: T },
      {
        kind: 'span.compensated',
        version: 1,
        spanId: 'sp_2',
        agent: 'bureau',
        compensatedAt: T,
        reason: 'walk-back',
      },
    ]);
    const html = renderGraph(state);
    expect(html).toMatch(/data-agent="bureau"[^>]*stroke="#C67E2F"/);
    expect(html).toMatch(/data-agent="bureau"[^>]*stroke-dasharray=/);
  });
});

describe('<GraphVisualizer> — accessibility', () => {
  it('marks every node group as a focusable button with role and tabIndex', () => {
    const html = renderGraph();
    for (const _agent of PIPELINE_NODES) {
      // count is what matters — at least one tabindex/role per agent
    }
    const tabindexes = html.match(/tabIndex="0"|tabindex="0"/g) ?? [];
    const roles = html.match(/role="button"/g) ?? [];
    expect(tabindexes.length).toBeGreaterThanOrEqual(PIPELINE_NODES.length);
    expect(roles.length).toBeGreaterThanOrEqual(PIPELINE_NODES.length);
  });

  it('exposes a Spanish aria-label that reflects the agent and current state', () => {
    const state = play([
      { kind: 'span.start', version: 1, spanId: 'sp_1', agent: 'identity', at: T },
    ]);
    const html = renderGraph(state);
    expect(html).toMatch(/aria-label="Agente Identidad — ejecutando"/);
  });

  it('uses the right Spanish state label for each NodeState', () => {
    const allStates: Array<[string, string]> = [
      ['PENDING', 'pendiente'],
      ['RUNNING', 'ejecutando'],
      ['COMPLETE', 'completado'],
      ['FAILED', 'fallado'],
      ['COMPENSATED', 'compensado'],
    ];
    for (const [stateName, expected] of allStates) {
      const events: StreamEvent[] = [
        { kind: 'span.start', version: 1, spanId: 'sp_1', agent: 'bureau', at: T },
      ];
      if (stateName === 'COMPLETE' || stateName === 'COMPENSATED') {
        events.push({ kind: 'span.complete', version: 1, spanId: 'sp_1', agent: 'bureau', at: T });
      }
      if (stateName === 'COMPENSATED') {
        events.push({
          kind: 'span.compensated',
          version: 1,
          spanId: 'sp_2',
          agent: 'bureau',
          compensatedAt: T,
          reason: 'walk-back',
        });
      }
      if (stateName === 'FAILED') {
        events.push({ kind: 'span.failed', version: 1, spanId: 'sp_1', agent: 'bureau', reason: 'x', at: T });
      }
      if (stateName === 'PENDING') {
        events.length = 0;
      }
      const state = events.reduce(reduce, initialGraphState());
      const html = renderGraph(state);
      expect(html, `state=${stateName}`).toContain(`Agente Buró — ${expected}`);
    }
  });

  it('renders a focus ring element so focus-visible CSS can target it without overriding the state stroke', () => {
    const html = renderGraph();
    const rings = html.match(/data-graph-focus-ring/g) ?? [];
    expect(rings).toHaveLength(PIPELINE_NODES.length);
  });
});

describe('<GraphVisualizer> — RUNNING ring animation hooks', () => {
  it('renders two expanding rings ONLY on RUNNING nodes', () => {
    const state = play([
      { kind: 'span.start', version: 1, spanId: 'sp_1', agent: 'policy', at: T },
    ]);
    const html = renderGraph(state);
    const outer = html.match(/data-graph-running-ring="outer"/g) ?? [];
    const inner = html.match(/data-graph-running-ring="inner"/g) ?? [];
    expect(outer).toHaveLength(1);
    expect(inner).toHaveLength(1);
  });

  it('renders no expanding rings when no node is RUNNING', () => {
    const html = renderGraph(initialGraphState());
    expect(html).not.toContain('data-graph-running-ring');
  });
});

describe('<GraphVisualizer> — selection visual', () => {
  it('renders a teal selection ring on the selected agent only', () => {
    const html = renderToStaticMarkup(
      <GraphVisualizer state={initialGraphState()} selectedAgent="policy" />,
    );
    const selectedRings = html.match(/data-graph-selection-ring="true"/g) ?? [];
    expect(selectedRings).toHaveLength(1);
    // The selection marker sits inside the policy <g>
    expect(html).toMatch(
      /data-agent="policy"[^]*?data-graph-selection-ring="true"/,
    );
  });

  it('renders no selection ring when selectedAgent is null', () => {
    const html = renderToStaticMarkup(<GraphVisualizer state={initialGraphState()} />);
    expect(html).not.toContain('data-graph-selection-ring');
  });
});

describe('<GraphVisualizer> — fan-out layout (vertical)', () => {
  it('renders bureau and alt_score with different x coordinates (parallel branch splits horizontally)', () => {
    const html = renderGraph();
    const bureau = html.match(/data-agent="bureau"[^>]*cx="(\d+(?:\.\d+)?)"/);
    const altScore = html.match(/data-agent="alt_score"[^>]*cx="(\d+(?:\.\d+)?)"/);
    expect(bureau).toBeTruthy();
    expect(altScore).toBeTruthy();
    expect(bureau![1]).not.toBe(altScore![1]);
  });

  it('lays out the pipeline top → bottom (identity above decision)', () => {
    const html = renderGraph();
    const identity = html.match(/data-agent="identity"[^>]*cy="(\d+(?:\.\d+)?)"/);
    const decision = html.match(/data-agent="decision"[^>]*cy="(\d+(?:\.\d+)?)"/);
    expect(parseFloat(identity![1])).toBeLessThan(parseFloat(decision![1]));
  });

  it('renders edges between sequential agents', () => {
    const html = renderGraph();
    // each edge has data-edge="from-to"
    expect(html).toContain('data-edge="identity-income"');
    expect(html).toContain('data-edge="income-bureau"');
    expect(html).toContain('data-edge="income-alt_score"');
    expect(html).toContain('data-edge="bureau-policy"');
    expect(html).toContain('data-edge="alt_score-policy"');
    expect(html).toContain('data-edge="policy-decision"');
  });
});
