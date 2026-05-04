/**
 * Tracer is the swappable observability boundary.
 * `ConsoleTracer` ships in slice 1; `LangfuseTracer` replaces it in
 * a later slice without touching call sites.
 */
export interface Span {
  setAttribute(key: string, value: unknown): void;
  addEvent(name: string, attrs?: Record<string, unknown>): void;
}

export interface Tracer {
  span<T>(
    name: string,
    initialAttrs: Record<string, unknown>,
    fn: (span: Span) => Promise<T>,
  ): Promise<T>;
}

interface SpanRecord {
  name: string;
  attributes: Record<string, unknown>;
  events: Array<{ name: string; attrs: Record<string, unknown>; at: number }>;
  startedAt: number;
  durationMs: number;
  status: 'ok' | 'error';
  error?: string;
}

function makeSpan(record: SpanRecord): Span {
  return {
    setAttribute(key, value) {
      record.attributes[key] = value;
    },
    addEvent(name, attrs = {}) {
      record.events.push({ name, attrs, at: Date.now() });
    },
  };
}

export class ConsoleTracer implements Tracer {
  async span<T>(
    name: string,
    initialAttrs: Record<string, unknown>,
    fn: (span: Span) => Promise<T>,
  ): Promise<T> {
    const record: SpanRecord = {
      name,
      attributes: { ...initialAttrs },
      events: [],
      startedAt: Date.now(),
      durationMs: 0,
      status: 'ok',
    };
    const span = makeSpan(record);

    try {
      const result = await fn(span);
      record.durationMs = Date.now() - record.startedAt;
      this.emit(record);
      return result;
    } catch (err) {
      record.durationMs = Date.now() - record.startedAt;
      record.status = 'error';
      record.error = err instanceof Error ? err.message : String(err);
      this.emit(record);
      throw err;
    }
  }

  private emit(record: SpanRecord): void {
    console.log(JSON.stringify({ type: 'span', ...record }));
  }
}

export { RecordingTracer } from './recording-tracer';
