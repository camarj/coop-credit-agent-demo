import { describe, it, expect } from 'vitest';
import { streamEventSchema, type StreamEvent } from '@/lib/streaming/event-schema';

const baseAt = 1730000000000;

describe('streamEventSchema — span lifecycle', () => {
  it('accepts a valid span.start frame', () => {
    const event = {
      kind: 'span.start',
      version: 1,
      spanId: 'span_01HXYZ',
      agent: 'identity',
      at: baseAt,
    };
    const parsed = streamEventSchema.parse(event);
    expect(parsed.kind).toBe('span.start');
    expect(parsed).toMatchObject(event);
  });

  it('accepts a valid span.complete frame', () => {
    const event = {
      kind: 'span.complete',
      version: 1,
      spanId: 'span_01HXYZ',
      agent: 'bureau',
      at: baseAt,
    };
    expect(() => streamEventSchema.parse(event)).not.toThrow();
  });

  it('accepts a valid span.failed frame with reason', () => {
    const event = {
      kind: 'span.failed',
      version: 1,
      spanId: 'span_01HXYZ',
      agent: 'policy',
      reason: 'rules.timeout',
      at: baseAt,
    };
    const parsed = streamEventSchema.parse(event);
    if (parsed.kind === 'span.failed') {
      expect(parsed.reason).toBe('rules.timeout');
    } else {
      throw new Error('discriminant did not narrow correctly');
    }
  });

  it('accepts a valid span.compensated frame', () => {
    const event = {
      kind: 'span.compensated',
      version: 1,
      spanId: 'span_01HXYZ',
      agent: 'bureau',
      compensatedAt: baseAt,
      reason: 'policy.failed downstream',
    };
    const parsed = streamEventSchema.parse(event);
    if (parsed.kind === 'span.compensated') {
      expect(parsed.compensatedAt).toBe(baseAt);
      expect(parsed.agent).toBe('bureau');
    } else {
      throw new Error('discriminant did not narrow correctly');
    }
  });
});

describe('streamEventSchema — span content events', () => {
  it('accepts a span.event with name and attributes', () => {
    const event = {
      kind: 'span.event',
      version: 1,
      spanId: 'span_01HXYZ',
      agent: 'policy',
      name: 'rules.retrieved',
      attrs: { count: 4, ruleIds: ['p-001', 'p-002'] },
      at: baseAt,
    };
    expect(() => streamEventSchema.parse(event)).not.toThrow();
  });

  it('accepts a span.attribute frame with key and value', () => {
    const event = {
      kind: 'span.attribute',
      version: 1,
      spanId: 'span_01HXYZ',
      agent: 'income',
      key: 'dti',
      value: 0.42,
      at: baseAt,
    };
    expect(() => streamEventSchema.parse(event)).not.toThrow();
  });
});

describe('streamEventSchema — orchestrator-level events', () => {
  it('accepts orchestrator.complete', () => {
    const event = { kind: 'orchestrator.complete', version: 1, at: baseAt };
    expect(() => streamEventSchema.parse(event)).not.toThrow();
  });

  it('accepts orchestrator.failed with reason', () => {
    const event = {
      kind: 'orchestrator.failed',
      version: 1,
      reason: 'saga executed after policy failure',
      at: baseAt,
    };
    expect(() => streamEventSchema.parse(event)).not.toThrow();
  });

  it('accepts already_complete', () => {
    const event = { kind: 'already_complete', version: 1, at: baseAt };
    expect(() => streamEventSchema.parse(event)).not.toThrow();
  });
});

describe('streamEventSchema — rejections at the boundary', () => {
  it('rejects events without version field', () => {
    const event = { kind: 'span.start', spanId: 's1', agent: 'identity', at: baseAt };
    expect(() => streamEventSchema.parse(event)).toThrow();
  });

  it('rejects events with future version (>1)', () => {
    const event = {
      kind: 'span.start',
      version: 2,
      spanId: 's1',
      agent: 'identity',
      at: baseAt,
    };
    expect(() => streamEventSchema.parse(event)).toThrow();
  });

  it('rejects unknown kind', () => {
    const event = { kind: 'span.weird', version: 1, at: baseAt };
    expect(() => streamEventSchema.parse(event)).toThrow();
  });

  it('rejects span.start with agent not in PIPELINE_NODES', () => {
    const event = {
      kind: 'span.start',
      version: 1,
      spanId: 's1',
      agent: 'unknown_agent',
      at: baseAt,
    };
    expect(() => streamEventSchema.parse(event)).toThrow();
  });

  it('rejects span.compensated without compensatedAt', () => {
    const event = {
      kind: 'span.compensated',
      version: 1,
      spanId: 's1',
      agent: 'bureau',
      reason: 'rolled back',
    };
    expect(() => streamEventSchema.parse(event)).toThrow();
  });
});

describe('StreamEvent type discrimination', () => {
  it('exposes kind as discriminant for narrowing', () => {
    const incoming: unknown = {
      kind: 'span.event',
      version: 1,
      spanId: 's1',
      agent: 'identity',
      name: 'check.completed',
      attrs: {},
      at: baseAt,
    };
    const parsed = streamEventSchema.parse(incoming) satisfies StreamEvent;
    if (parsed.kind === 'span.event') {
      expect(parsed.name).toBe('check.completed');
    }
  });
});
