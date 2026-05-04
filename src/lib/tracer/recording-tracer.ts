import type { Span, Tracer } from './index';

export interface RecordedSpan {
  name: string;
  attributes: Record<string, unknown>;
  events: Array<{ name: string; attrs: Record<string, unknown> }>;
  status: 'ok' | 'error';
  error?: string;
}

/**
 * In-memory `Tracer` impl used by tests. Captures every span, attribute,
 * and event so assertions can be made directly against `tracer.spans`.
 */
export class RecordingTracer implements Tracer {
  readonly spans: RecordedSpan[] = [];

  async span<T>(
    name: string,
    initialAttrs: Record<string, unknown>,
    fn: (span: Span) => Promise<T>,
  ): Promise<T> {
    const recorded: RecordedSpan = {
      name,
      attributes: { ...initialAttrs },
      events: [],
      status: 'ok',
    };
    this.spans.push(recorded);

    const span: Span = {
      setAttribute(key, value) {
        recorded.attributes[key] = value;
      },
      addEvent(eventName, attrs = {}) {
        recorded.events.push({ name: eventName, attrs });
      },
    };

    try {
      return await fn(span);
    } catch (err) {
      recorded.status = 'error';
      recorded.error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }
}
