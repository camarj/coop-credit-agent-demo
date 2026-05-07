import { describe, it, expect, vi } from 'vitest';
import { applyFrame } from '@/components/graph/apply-frame';
import type { StreamEvent } from '@/lib/streaming/event-schema';

const T = 1730000000000;

describe('applyFrame — happy path', () => {
  it('parses a valid SSE data string and dispatches the typed event', () => {
    const dispatch = vi.fn();
    const raw = JSON.stringify({
      kind: 'span.start',
      version: 1,
      spanId: 'sp_1',
      agent: 'identity',
      at: T,
    });

    applyFrame(raw, dispatch);

    expect(dispatch).toHaveBeenCalledTimes(1);
    const dispatched = dispatch.mock.calls[0][0] as StreamEvent;
    expect(dispatched.kind).toBe('span.start');
    if (dispatched.kind === 'span.start') {
      expect(dispatched.agent).toBe('identity');
    }
  });

  it('dispatches every variant the schema knows', () => {
    const dispatch = vi.fn();
    applyFrame(JSON.stringify({ kind: 'orchestrator.complete', version: 1, at: T }), dispatch);
    applyFrame(JSON.stringify({ kind: 'already_complete', version: 1, at: T }), dispatch);
    applyFrame(
      JSON.stringify({
        kind: 'orchestrator.failed',
        version: 1,
        at: T,
        reason: 'saga executed',
      }),
      dispatch,
    );
    expect(dispatch).toHaveBeenCalledTimes(3);
  });
});

describe('applyFrame — defensive boundary', () => {
  it('silently drops malformed JSON', () => {
    const dispatch = vi.fn();
    applyFrame('not-json {', dispatch);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('silently drops events with version > 1 (forward-compat)', () => {
    const dispatch = vi.fn();
    applyFrame(
      JSON.stringify({
        kind: 'span.start',
        version: 2,
        spanId: 'sp_1',
        agent: 'identity',
        at: T,
      }),
      dispatch,
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('silently drops events with unknown kind', () => {
    const dispatch = vi.fn();
    applyFrame(JSON.stringify({ kind: 'span.weird', version: 1, at: T }), dispatch);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('silently drops events with agent outside PIPELINE_NODES', () => {
    const dispatch = vi.fn();
    applyFrame(
      JSON.stringify({
        kind: 'span.start',
        version: 1,
        spanId: 'sp_1',
        agent: 'unknown_agent',
        at: T,
      }),
      dispatch,
    );
    expect(dispatch).not.toHaveBeenCalled();
  });
});
