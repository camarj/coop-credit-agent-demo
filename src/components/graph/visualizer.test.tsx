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

describe('<GraphVisualizer> — fan-out layout', () => {
  it('renders bureau and alt_score with different y coordinates (parallel branch)', () => {
    const html = renderGraph();
    const bureau = html.match(/data-agent="bureau"[^>]*cy="(\d+(?:\.\d+)?)"/);
    const altScore = html.match(/data-agent="alt_score"[^>]*cy="(\d+(?:\.\d+)?)"/);
    expect(bureau).toBeTruthy();
    expect(altScore).toBeTruthy();
    expect(bureau![1]).not.toBe(altScore![1]);
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
