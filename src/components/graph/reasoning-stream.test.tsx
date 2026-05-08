import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReasoningStream, formatLogEntry } from '@/components/graph/reasoning-stream';
import {
  initialGraphState,
  reduce,
  type LogEntry,
} from '@/lib/streaming/graph-reducer';
import type { StreamEvent } from '@/lib/streaming/event-schema';

const T = 1730000000000;

function play(events: StreamEvent[]) {
  return events.reduce(reduce, initialGraphState());
}

describe('<ReasoningStream> — render', () => {
  it('renders an empty placeholder when the log is empty', () => {
    const html = renderToStaticMarkup(<ReasoningStream state={initialGraphState()} />);
    expect(html).toContain('Conectando');
  });

  it('renders one entry per loggable event', () => {
    const state = play([
      { kind: 'span.start', version: 1, spanId: 'sp_1', agent: 'identity', at: T },
      {
        kind: 'span.event',
        version: 1,
        spanId: 'sp_1',
        agent: 'identity',
        name: 'check.completed',
        attrs: { ok: true },
        at: T,
      },
      { kind: 'span.complete', version: 1, spanId: 'sp_1', agent: 'identity', at: T },
    ]);
    const html = renderToStaticMarkup(<ReasoningStream state={state} />);
    const entries = html.match(/data-stream-entry/g) ?? [];
    expect(entries).toHaveLength(3);
  });

  it('tags the most recent entry with data-latest="true"', () => {
    const state = play([
      { kind: 'span.start', version: 1, spanId: 'sp_1', agent: 'identity', at: T },
      { kind: 'span.complete', version: 1, spanId: 'sp_1', agent: 'identity', at: T },
    ]);
    const html = renderToStaticMarkup(<ReasoningStream state={state} />);
    const latest = html.match(/data-latest="true"/g) ?? [];
    expect(latest).toHaveLength(1);
  });
});

describe('formatLogEntry — Spanish narrative copy', () => {
  it('formats span.start as "arrancó"', () => {
    const entry: LogEntry = {
      kind: 'span.start',
      version: 1,
      spanId: 'sp_1',
      agent: 'identity',
      at: T,
    };
    expect(formatLogEntry(entry)?.text).toContain('arrancó');
  });

  it('formats span.complete with "completado"', () => {
    const entry: LogEntry = {
      kind: 'span.complete',
      version: 1,
      spanId: 'sp_1',
      agent: 'income',
      at: T,
    };
    expect(formatLogEntry(entry)?.text).toContain('completado');
  });

  it('formats span.failed with the reason', () => {
    const entry: LogEntry = {
      kind: 'span.failed',
      version: 1,
      spanId: 'sp_1',
      agent: 'bureau',
      reason: 'circuit breaker open',
      at: T,
    };
    expect(formatLogEntry(entry)?.text).toContain('circuit breaker open');
  });

  it('formats span.attribute as key: value (filtering noisy infra keys)', () => {
    const dti: LogEntry = {
      kind: 'span.attribute',
      version: 1,
      spanId: 'sp_1',
      agent: 'income',
      key: 'dti',
      value: 0.42,
      at: T,
    };
    const result = formatLogEntry(dti);
    expect(result?.text).toContain('dti');
    expect(result?.text).toContain('0.42');
  });

  it('returns null for noisy infra attributes (breaker.state, llm.model.actual)', () => {
    const noise: LogEntry = {
      kind: 'span.attribute',
      version: 1,
      spanId: 'sp_1',
      agent: 'identity',
      key: 'breaker.state',
      value: 'CLOSED',
      at: T,
    };
    expect(formatLogEntry(noise)).toBeNull();
  });

  it('formats span.event with the event name', () => {
    const entry: LogEntry = {
      kind: 'span.event',
      version: 1,
      spanId: 'sp_1',
      agent: 'policy',
      name: 'rules.retrieved',
      attrs: { count: 4 },
      at: T,
    };
    expect(formatLogEntry(entry)?.text).toContain('rules.retrieved');
  });

  it('formats span.compensated with "compensado"', () => {
    const entry: LogEntry = {
      kind: 'span.compensated',
      version: 1,
      spanId: 'sp_1',
      agent: 'bureau',
      compensatedAt: T,
      reason: 'walk-back',
    };
    expect(formatLogEntry(entry)?.text).toContain('compensado');
  });
});
