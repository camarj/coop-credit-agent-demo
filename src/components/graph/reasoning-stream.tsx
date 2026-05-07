'use client';
import { useEffect, useRef } from 'react';
import type { GraphState, LogEntry } from '@/lib/streaming/graph-reducer';
import { NODE_LABELS } from './labels';
import './reasoning-stream.css';

const NOISY_ATTR_KEYS = new Set([
  'breaker.state',
  'llm.model.requested',
  'llm.model.actual',
]);

interface FormattedEntry {
  agent: LogEntry['agent'];
  text: string;
  kind: LogEntry['kind'];
}

export function formatLogEntry(entry: LogEntry): FormattedEntry | null {
  switch (entry.kind) {
    case 'span.start':
      return { agent: entry.agent, kind: entry.kind, text: 'arrancó' };
    case 'span.complete':
      return { agent: entry.agent, kind: entry.kind, text: 'completado' };
    case 'span.failed':
      return { agent: entry.agent, kind: entry.kind, text: `falló — ${entry.reason}` };
    case 'span.compensated':
      return { agent: entry.agent, kind: entry.kind, text: `compensado — ${entry.reason}` };
    case 'span.event':
      return { agent: entry.agent, kind: entry.kind, text: entry.name };
    case 'span.attribute': {
      if (NOISY_ATTR_KEYS.has(entry.key)) return null;
      const value =
        typeof entry.value === 'string'
          ? entry.value
          : typeof entry.value === 'number' || typeof entry.value === 'boolean'
            ? String(entry.value)
            : JSON.stringify(entry.value);
      return { agent: entry.agent, kind: entry.kind, text: `${entry.key} = ${value}` };
    }
  }
}

interface Props {
  state: GraphState;
}

export function ReasoningStream({ state }: Props) {
  const ref = useRef<HTMLOListElement>(null);
  const formatted = state.log
    .map((entry, index) => ({ entry, index, formatted: formatLogEntry(entry) }))
    .filter(
      (item): item is { entry: LogEntry; index: number; formatted: FormattedEntry } =>
        item.formatted !== null,
    );

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [formatted.length]);

  if (formatted.length === 0) {
    return (
      <div className="reasoning-stream reasoning-stream--empty" data-testid="reasoning-stream">
        <p>Conectando con el orquestador…</p>
      </div>
    );
  }

  const lastIndex = formatted.length - 1;

  return (
    <ol
      ref={ref}
      className="reasoning-stream"
      data-testid="reasoning-stream"
      aria-live="polite"
      aria-label="Razonamiento en vivo"
    >
      {formatted.map(({ entry, index, formatted: f }) => {
        const isLatest = index === formatted[lastIndex].index;
        return (
          <li
            key={index}
            data-stream-entry
            data-agent={f.agent}
            data-kind={f.kind}
            data-latest={isLatest ? 'true' : undefined}
            className="reasoning-stream__entry"
          >
            <span className="reasoning-stream__eyebrow">
              {NODE_LABELS[f.agent]}
            </span>
            <span className="reasoning-stream__text">{f.text}</span>
            <span className="reasoning-stream__time">{formatTime(entryTimestamp(entry))}</span>
          </li>
        );
      })}
    </ol>
  );
}

function entryTimestamp(entry: LogEntry): number {
  return entry.kind === 'span.compensated' ? entry.compensatedAt : entry.at;
}

function formatTime(at: number): string {
  if (!at) return '';
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
