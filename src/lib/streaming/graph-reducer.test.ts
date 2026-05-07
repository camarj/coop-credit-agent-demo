import { describe, it, expect } from 'vitest';
import {
  initialGraphState,
  reduce,
  type GraphState,
} from '@/lib/streaming/graph-reducer';
import type { StreamEvent } from '@/lib/streaming/event-schema';
import { PIPELINE_NODES } from '@/lib/orchestrator/pipeline';

const T = 1730000000000;

function start(agent: string, spanId = 'sp_1'): StreamEvent {
  return {
    kind: 'span.start',
    version: 1,
    spanId,
    agent: agent as never,
    at: T,
  };
}
function complete(agent: string, spanId = 'sp_1'): StreamEvent {
  return {
    kind: 'span.complete',
    version: 1,
    spanId,
    agent: agent as never,
    at: T,
  };
}
function failed(agent: string, reason = 'boom', spanId = 'sp_1'): StreamEvent {
  return {
    kind: 'span.failed',
    version: 1,
    spanId,
    agent: agent as never,
    reason,
    at: T,
  };
}
function compensated(agent: string, spanId = 'sp_2'): StreamEvent {
  return {
    kind: 'span.compensated',
    version: 1,
    spanId,
    agent: agent as never,
    compensatedAt: T,
    reason: 'walk-back',
  };
}

function play(events: StreamEvent[], from: GraphState = initialGraphState()): GraphState {
  return events.reduce(reduce, from);
}

describe('initialGraphState', () => {
  it('starts with all PIPELINE_NODES in PENDING and status=streaming', () => {
    const s = initialGraphState();
    expect(s.status).toBe('streaming');
    for (const node of PIPELINE_NODES) {
      expect(s.nodes[node].state).toBe('PENDING');
      expect(s.nodes[node].currentSpanId).toBeNull();
      expect(s.nodes[node].events).toEqual([]);
      expect(s.nodes[node].attributes).toEqual({});
    }
  });
});

describe('reduce — span lifecycle transitions', () => {
  it('span.start moves PENDING → RUNNING and sets currentSpanId', () => {
    const s = play([start('identity', 'sp_1')]);
    expect(s.nodes.identity.state).toBe('RUNNING');
    expect(s.nodes.identity.currentSpanId).toBe('sp_1');
  });

  it('span.complete moves RUNNING → COMPLETE', () => {
    const s = play([start('identity'), complete('identity')]);
    expect(s.nodes.identity.state).toBe('COMPLETE');
  });

  it('span.failed moves RUNNING → FAILED and stores reason', () => {
    const s = play([start('bureau'), failed('bureau', 'unreachable')]);
    expect(s.nodes.bureau.state).toBe('FAILED');
    expect(s.nodes.bureau.attributes.failureReason).toBe('unreachable');
  });

  it('GATE: span.compensated moves COMPLETE → COMPENSATED', () => {
    const s = play([start('bureau'), complete('bureau'), compensated('bureau')]);
    expect(s.nodes.bureau.state).toBe('COMPENSATED');
  });

  it('span.compensated is ignored if node is FAILED (cannot compensate a failed agent)', () => {
    const s = play([start('bureau'), failed('bureau'), compensated('bureau')]);
    expect(s.nodes.bureau.state).toBe('FAILED');
  });

  it('span.compensated is ignored if node is PENDING', () => {
    const s = play([compensated('bureau')]);
    expect(s.nodes.bureau.state).toBe('PENDING');
  });
});

describe('reduce — span content events', () => {
  it('span.event appends to nodes[agent].events without changing state', () => {
    const evt: StreamEvent = {
      kind: 'span.event',
      version: 1,
      spanId: 'sp_1',
      agent: 'policy',
      name: 'rules.retrieved',
      attrs: { count: 4 },
      at: T,
    };
    const s = play([start('policy'), evt]);
    expect(s.nodes.policy.state).toBe('RUNNING');
    expect(s.nodes.policy.events).toEqual([{ name: 'rules.retrieved', attrs: { count: 4 }, at: T }]);
  });

  it('span.attribute merges into nodes[agent].attributes', () => {
    const a1: StreamEvent = {
      kind: 'span.attribute',
      version: 1,
      spanId: 'sp_1',
      agent: 'income',
      key: 'dti',
      value: 0.42,
      at: T,
    };
    const a2: StreamEvent = {
      kind: 'span.attribute',
      version: 1,
      spanId: 'sp_1',
      agent: 'income',
      key: 'monthlyIncome',
      value: 1500,
      at: T,
    };
    const s = play([start('income'), a1, a2]);
    expect(s.nodes.income.attributes).toMatchObject({ dti: 0.42, monthlyIncome: 1500 });
  });
});

describe('reduce — orchestrator-level events', () => {
  it('orchestrator.complete moves status streaming → complete', () => {
    const s = play([{ kind: 'orchestrator.complete', version: 1, at: T }]);
    expect(s.status).toBe('complete');
  });

  it('orchestrator.failed moves status streaming → failed and stores reason', () => {
    const s = play([
      { kind: 'orchestrator.failed', version: 1, at: T, reason: 'saga executed after policy failure' },
    ]);
    expect(s.status).toBe('failed');
    expect(s.failureReason).toBe('saga executed after policy failure');
  });

  it('already_complete moves status to complete (treated as terminal)', () => {
    const s = play([{ kind: 'already_complete', version: 1, at: T }]);
    expect(s.status).toBe('complete');
  });
});

describe('reduce — log feed (drives ReasoningStream)', () => {
  it('starts with an empty log', () => {
    expect(initialGraphState().log).toEqual([]);
  });

  it('appends every loggable event in arrival order', () => {
    const events: StreamEvent[] = [
      start('identity'),
      {
        kind: 'span.event',
        version: 1,
        spanId: 'sp_1',
        agent: 'identity',
        name: 'check.completed',
        attrs: { ok: true },
        at: T,
      },
      complete('identity'),
      start('income', 'sp_2'),
    ];
    const s = play(events);
    expect(s.log).toHaveLength(4);
    expect(s.log.map((e) => e.kind)).toEqual([
      'span.start',
      'span.event',
      'span.complete',
      'span.start',
    ]);
  });

  it('does NOT log orchestrator-level events (status changes are not narrative)', () => {
    const events: StreamEvent[] = [
      start('identity'),
      complete('identity'),
      { kind: 'orchestrator.complete', version: 1, at: T },
    ];
    const s = play(events);
    expect(s.log).toHaveLength(2);
    expect(s.log.map((e) => e.kind)).toEqual(['span.start', 'span.complete']);
  });
});

describe('reduce — purity', () => {
  it('does not mutate the previous state', () => {
    const prev = initialGraphState();
    const snapshot = JSON.stringify(prev);
    reduce(prev, start('identity'));
    expect(JSON.stringify(prev)).toBe(snapshot);
  });

  it('returns a new reference for the changed node only', () => {
    const prev = initialGraphState();
    const next = reduce(prev, start('identity'));
    expect(next).not.toBe(prev);
    expect(next.nodes.identity).not.toBe(prev.nodes.identity);
    expect(next.nodes.bureau).toBe(prev.nodes.bureau);
  });
});
