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

function parseAgent(spanName: string): AgentName | null {
  const head = spanName.split('.', 1)[0];
  return PIPELINE_SET.has(head) ? (head as AgentName) : null;
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
      const agent = parseAgent(name);
      if (!agent) return fn(noopSpan);

      const spanId = `span_${randomUUID()}`;

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
