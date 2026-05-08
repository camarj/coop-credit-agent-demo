import { randomUUID } from 'node:crypto';
import type { Span, Tracer } from '@/lib/tracer';
import { PIPELINE_NODES, type AgentName } from '@/lib/orchestrator/pipeline';
import type { StreamEvent } from '@/lib/streaming/event-schema';

export const SENSITIVE_KEYS = new Set([
  'cedula',
  'password',
  'token',
  'secret',
  'apikey',
  'authorization',
  'cookie',
  'creditcard',
  'cvv',
]);

const PIPELINE_SET = new Set<string>(PIPELINE_NODES);

export type Emit = (event: StreamEvent) => void;

function isSensitive(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

function redactDeep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redactDeep);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitive(k) ? '[REDACTED]' : redactDeep(v);
  }
  return out;
}

function redactAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
  return redactDeep(attrs) as Record<string, unknown>;
}

type SpanKind = 'execute' | 'compensate' | 'other';

function parseSpan(spanName: string): { agent: AgentName; kind: SpanKind } | null {
  const parts = spanName.split('.');
  const head = parts[0];
  if (!PIPELINE_SET.has(head)) return null;
  const tail = parts[1];
  const kind: SpanKind = tail === 'compensate' ? 'compensate' : tail === 'execute' ? 'execute' : 'other';
  return { agent: head as AgentName, kind };
}

function safeEmit(emit: Emit, event: StreamEvent): void {
  try {
    emit(event);
  } catch {
    // SSE controller closed or downstream error — never break the span body.
  }
}

const noopSpan: Span = {
  setAttribute() {},
  addEvent() {},
};

export function createBroadcastTracer(emit: Emit): Tracer {
  return {
    async span<T>(
      name: string,
      _initialAttrs: Record<string, unknown>,
      fn: (span: Span) => Promise<T>,
    ): Promise<T> {
      const parsed = parseSpan(name);
      if (!parsed) return fn(noopSpan);
      const { agent, kind } = parsed;

      const spanId = `span_${randomUUID()}`;

      if (kind === 'compensate') {
        // Saga walk-back: emit nothing on entry, span.compensated on success
        // (single frame), nothing on failure (orchestrator swallows compensate
        // failures so they don't mask the original cause). addEvent/setAttribute
        // are silenced — see ADR-0009 §3 (no nodes[agent] noise during walk-back).
        const result = await fn(noopSpan);
        safeEmit(emit, {
          kind: 'span.compensated',
          version: 1,
          spanId,
          agent,
          compensatedAt: Date.now(),
          reason: 'saga walk-back',
        });
        return result;
      }

      safeEmit(emit, {
        kind: 'span.start',
        version: 1,
        spanId,
        agent,
        at: Date.now(),
      });

      const span: Span = {
        setAttribute(key, value) {
          safeEmit(emit, {
            kind: 'span.attribute',
            version: 1,
            spanId,
            agent,
            key,
            value: isSensitive(key) ? '[REDACTED]' : redactDeep(value),
            at: Date.now(),
          });
        },
        addEvent(eventName, attrs = {}) {
          safeEmit(emit, {
            kind: 'span.event',
            version: 1,
            spanId,
            agent,
            name: eventName,
            attrs: redactAttrs(attrs),
            at: Date.now(),
          });
        },
      };

      try {
        const result = await fn(span);
        safeEmit(emit, {
          kind: 'span.complete',
          version: 1,
          spanId,
          agent,
          at: Date.now(),
        });
        return result;
      } catch (err) {
        safeEmit(emit, {
          kind: 'span.failed',
          version: 1,
          spanId,
          agent,
          reason: err instanceof Error ? err.message : String(err),
          at: Date.now(),
        });
        throw err;
      }
    },
  };
}
