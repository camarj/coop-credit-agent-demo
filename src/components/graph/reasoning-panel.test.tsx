import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReasoningPanel } from '@/components/graph/reasoning-panel';
import {
  initialGraphState,
  reduce,
  type GraphState,
} from '@/lib/streaming/graph-reducer';
import type { StreamEvent } from '@/lib/streaming/event-schema';

const T = 1730000000000;

function play(events: StreamEvent[]): GraphState {
  return events.reduce(reduce, initialGraphState());
}

function noop() {}

describe('<ReasoningPanel> — visibility', () => {
  it('renders nothing when selectedAgent is null', () => {
    const html = renderToStaticMarkup(
      <ReasoningPanel selectedAgent={null} state={initialGraphState()} onClose={noop} />,
    );
    expect(html).toBe('');
  });

  it('renders an aside with role=dialog when an agent is selected', () => {
    const html = renderToStaticMarkup(
      <ReasoningPanel selectedAgent="identity" state={initialGraphState()} onClose={noop} />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('data-testid="reasoning-panel"');
    expect(html).toContain('data-agent="identity"');
  });
});

describe('<ReasoningPanel> — header', () => {
  it('shows the Spanish agent name and current state label', () => {
    const state = play([
      { kind: 'span.start', version: 1, spanId: 'sp_1', agent: 'policy', at: T },
    ]);
    const html = renderToStaticMarkup(
      <ReasoningPanel selectedAgent="policy" state={state} onClose={noop} />,
    );
    expect(html).toContain('Política');
    expect(html).toContain('ejecutando');
  });

  it('renders a close button with aria-label "Cerrar panel"', () => {
    const html = renderToStaticMarkup(
      <ReasoningPanel selectedAgent="identity" state={initialGraphState()} onClose={noop} />,
    );
    expect(html).toMatch(/aria-label="Cerrar panel"/);
  });
});

describe('<ReasoningPanel> — events list', () => {
  it('renders one entry per addEvent the agent has emitted', () => {
    const events: StreamEvent[] = [
      { kind: 'span.start', version: 1, spanId: 'sp_1', agent: 'policy', at: T },
      {
        kind: 'span.event',
        version: 1,
        spanId: 'sp_1',
        agent: 'policy',
        name: 'rules.retrieved',
        attrs: { count: 4 },
        at: T,
      },
      {
        kind: 'span.event',
        version: 1,
        spanId: 'sp_1',
        agent: 'policy',
        name: 'llm.start',
        attrs: {},
        at: T,
      },
    ];
    const state = play(events);
    const html = renderToStaticMarkup(
      <ReasoningPanel selectedAgent="policy" state={state} onClose={noop} />,
    );
    expect(html).toContain('rules.retrieved');
    expect(html).toContain('llm.start');
  });

  it('renders the empty-state copy in Spanish when the agent has no events yet', () => {
    const html = renderToStaticMarkup(
      <ReasoningPanel selectedAgent="identity" state={initialGraphState()} onClose={noop} />,
    );
    expect(html).toContain('Sin eventos todavía');
  });
});

describe('<ReasoningPanel> — attributes', () => {
  it('renders a key/value list when the agent has setAttribute calls', () => {
    const events: StreamEvent[] = [
      { kind: 'span.start', version: 1, spanId: 'sp_1', agent: 'income', at: T },
      {
        kind: 'span.attribute',
        version: 1,
        spanId: 'sp_1',
        agent: 'income',
        key: 'dti',
        value: 0.42,
        at: T,
      },
      {
        kind: 'span.attribute',
        version: 1,
        spanId: 'sp_1',
        agent: 'income',
        key: 'monthlyIncome',
        value: 1500,
        at: T,
      },
    ];
    const state = play(events);
    const html = renderToStaticMarkup(
      <ReasoningPanel selectedAgent="income" state={state} onClose={noop} />,
    );
    expect(html).toContain('dti');
    expect(html).toContain('0.42');
    expect(html).toContain('monthlyIncome');
    expect(html).toContain('1500');
  });
});

describe('<ReasoningPanel> — failure surface', () => {
  it('shows the failure reason when the node is FAILED', () => {
    const state = play([
      { kind: 'span.start', version: 1, spanId: 'sp_1', agent: 'bureau', at: T },
      {
        kind: 'span.failed',
        version: 1,
        spanId: 'sp_1',
        agent: 'bureau',
        reason: 'equifax circuit breaker open',
        at: T,
      },
    ]);
    const html = renderToStaticMarkup(
      <ReasoningPanel selectedAgent="bureau" state={state} onClose={noop} />,
    );
    expect(html).toContain('equifax circuit breaker open');
    expect(html).toContain('fallado');
  });
});
