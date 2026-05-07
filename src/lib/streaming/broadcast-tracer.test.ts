import { describe, it, expect } from 'vitest';
import { createBroadcastTracer, SENSITIVE_KEYS } from '@/lib/streaming/broadcast-tracer';
import type { StreamEvent } from '@/lib/streaming/event-schema';
import { streamEventSchema } from '@/lib/streaming/event-schema';

function makeRecorder() {
  const events: StreamEvent[] = [];
  const emit = (event: StreamEvent) => {
    streamEventSchema.parse(event);
    events.push(event);
  };
  return { events, emit };
}

describe('BroadcastTracer — span lifecycle', () => {
  it('emits span.start and span.complete around a successful span', async () => {
    const { events, emit } = makeRecorder();
    const tracer = createBroadcastTracer(emit);

    await tracer.span('identity.execute', {}, async () => 'ok');

    expect(events.map((e) => e.kind)).toEqual(['span.start', 'span.complete']);
    const [start, complete] = events;
    if (start.kind !== 'span.start' || complete.kind !== 'span.complete') throw new Error('bad kinds');
    expect(start.agent).toBe('identity');
    expect(complete.agent).toBe('identity');
    expect(start.spanId).toBe(complete.spanId);
    expect(start.version).toBe(1);
    expect(typeof start.at).toBe('number');
  });

  it('emits span.failed with the error message when the span throws', async () => {
    const { events, emit } = makeRecorder();
    const tracer = createBroadcastTracer(emit);

    await expect(
      tracer.span('bureau.execute', {}, async () => {
        throw new Error('bureau unreachable');
      }),
    ).rejects.toThrow('bureau unreachable');

    expect(events.map((e) => e.kind)).toEqual(['span.start', 'span.failed']);
    const failed = events[1];
    if (failed.kind !== 'span.failed') throw new Error('expected span.failed');
    expect(failed.reason).toBe('bureau unreachable');
    expect(failed.agent).toBe('bureau');
  });

  it('uses unique spanIds across distinct spans', async () => {
    const { events, emit } = makeRecorder();
    const tracer = createBroadcastTracer(emit);

    await tracer.span('identity.execute', {}, async () => undefined);
    await tracer.span('identity.execute', {}, async () => undefined);

    const spanIds = events.filter((e) => e.kind === 'span.start').map((e) => (e as { spanId: string }).spanId);
    expect(new Set(spanIds).size).toBe(2);
  });
});

describe('BroadcastTracer — addEvent and setAttribute', () => {
  it('emits span.event for every addEvent call', async () => {
    const { events, emit } = makeRecorder();
    const tracer = createBroadcastTracer(emit);

    await tracer.span('policy.execute', {}, async (span) => {
      span.addEvent('rules.retrieved', { count: 4 });
    });

    const eventFrames = events.filter((e) => e.kind === 'span.event');
    expect(eventFrames).toHaveLength(1);
    const frame = eventFrames[0];
    if (frame.kind !== 'span.event') throw new Error('bad kind');
    expect(frame.name).toBe('rules.retrieved');
    expect(frame.attrs).toEqual({ count: 4 });
    expect(frame.agent).toBe('policy');
  });

  it('emits span.attribute for every setAttribute call', async () => {
    const { events, emit } = makeRecorder();
    const tracer = createBroadcastTracer(emit);

    await tracer.span('income.execute', {}, async (span) => {
      span.setAttribute('dti', 0.42);
    });

    const attrFrames = events.filter((e) => e.kind === 'span.attribute');
    expect(attrFrames).toHaveLength(1);
    const frame = attrFrames[0];
    if (frame.kind !== 'span.attribute') throw new Error('bad kind');
    expect(frame.key).toBe('dti');
    expect(frame.value).toBe(0.42);
  });

  it('shares the spanId between the parent span and its child events', async () => {
    const { events, emit } = makeRecorder();
    const tracer = createBroadcastTracer(emit);

    await tracer.span('decision.execute', {}, async (span) => {
      span.setAttribute('confidence', 0.87);
      span.addEvent('llm.completed', { tokens: 320 });
    });

    const spanIds = events.map((e) => ('spanId' in e ? e.spanId : null));
    expect(new Set(spanIds.filter(Boolean)).size).toBe(1);
  });
});

describe('BroadcastTracer — PII denylist (regulatory gate)', () => {
  it('redacts a sensitive key on setAttribute (cedula)', async () => {
    const { events, emit } = makeRecorder();
    const tracer = createBroadcastTracer(emit);

    await tracer.span('identity.execute', {}, async (span) => {
      span.setAttribute('cedula', '0915123456');
    });

    const attr = events.find((e) => e.kind === 'span.attribute');
    if (!attr || attr.kind !== 'span.attribute') throw new Error('missing attribute frame');
    expect(attr.value).toBe('[REDACTED]');
    expect(attr.value).not.toBe('0915123456');
  });

  it('redacts every key in SENSITIVE_KEYS', async () => {
    for (const key of SENSITIVE_KEYS) {
      const { events, emit } = makeRecorder();
      const tracer = createBroadcastTracer(emit);

      await tracer.span('identity.execute', {}, async (span) => {
        span.setAttribute(key, 'leaked-value');
      });

      const attr = events.find((e) => e.kind === 'span.attribute');
      if (!attr || attr.kind !== 'span.attribute') throw new Error(`missing attribute frame for ${key}`);
      expect(attr.value, `key ${key} must be redacted`).toBe('[REDACTED]');
    }
  });

  it('redacts case-insensitively (Cedula, CEDULA, ApiKey)', async () => {
    const { events, emit } = makeRecorder();
    const tracer = createBroadcastTracer(emit);

    await tracer.span('identity.execute', {}, async (span) => {
      span.setAttribute('Cedula', '111');
      span.setAttribute('CEDULA', '222');
      span.setAttribute('ApiKey', 'sk-...');
    });

    const attrs = events.filter((e) => e.kind === 'span.attribute');
    expect(attrs).toHaveLength(3);
    for (const a of attrs) {
      if (a.kind !== 'span.attribute') throw new Error('bad kind');
      expect(a.value).toBe('[REDACTED]');
    }
  });

  it('redacts sensitive keys nested inside addEvent attrs', async () => {
    const { events, emit } = makeRecorder();
    const tracer = createBroadcastTracer(emit);

    await tracer.span('identity.execute', {}, async (span) => {
      span.addEvent('check.completed', {
        ok: true,
        usuario: { nombre: 'Juan', cedula: '0915123456' },
      });
    });

    const evt = events.find((e) => e.kind === 'span.event');
    if (!evt || evt.kind !== 'span.event') throw new Error('missing event frame');
    expect(evt.attrs).toEqual({
      ok: true,
      usuario: { nombre: 'Juan', cedula: '[REDACTED]' },
    });
  });

  it('redacts sensitive keys inside arrays of objects', async () => {
    const { events, emit } = makeRecorder();
    const tracer = createBroadcastTracer(emit);

    await tracer.span('bureau.execute', {}, async (span) => {
      span.addEvent('match.candidates', {
        items: [
          { id: 'a', token: 'leak-1' },
          { id: 'b', token: 'leak-2' },
        ],
      });
    });

    const evt = events.find((e) => e.kind === 'span.event');
    if (!evt || evt.kind !== 'span.event') throw new Error('missing event frame');
    expect(evt.attrs).toEqual({
      items: [
        { id: 'a', token: '[REDACTED]' },
        { id: 'b', token: '[REDACTED]' },
      ],
    });
  });

  it('does not touch non-sensitive keys', async () => {
    const { events, emit } = makeRecorder();
    const tracer = createBroadcastTracer(emit);

    await tracer.span('income.execute', {}, async (span) => {
      span.setAttribute('amount', 1500);
      span.setAttribute('currency', 'USD');
    });

    const attrs = events.filter((e) => e.kind === 'span.attribute');
    expect(attrs).toHaveLength(2);
    if (attrs[0].kind !== 'span.attribute' || attrs[1].kind !== 'span.attribute') throw new Error('bad kinds');
    expect(attrs[0].value).toBe(1500);
    expect(attrs[1].value).toBe('USD');
  });
});

describe('BroadcastTracer — non-pipeline spans', () => {
  it('does not emit SSE frames for spans whose name is not <agent>.<x>', async () => {
    const { events, emit } = makeRecorder();
    const tracer = createBroadcastTracer(emit);

    await tracer.span('orchestrator.run', {}, async () => 'ok');
    await tracer.span('intake.execute', {}, async () => 'ok');

    expect(events).toHaveLength(0);
  });

  it('still runs the function body for non-pipeline spans (transparent)', async () => {
    const { emit } = makeRecorder();
    const tracer = createBroadcastTracer(emit);

    const result = await tracer.span('orchestrator.run', {}, async () => 42);
    expect(result).toBe(42);
  });
});

describe('BroadcastTracer — emit failures do not break spans', () => {
  it('keeps the span body running when emit throws', async () => {
    const tracer = createBroadcastTracer(() => {
      throw new Error('controller closed');
    });

    const result = await tracer.span('identity.execute', {}, async () => 'ok');
    expect(result).toBe('ok');
  });
});
