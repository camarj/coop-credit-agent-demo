'use client';
import { useEffect, useReducer, useState } from 'react';
import { initialGraphState, reduce, type GraphState } from '@/lib/streaming/graph-reducer';
import { applyFrame } from './apply-frame';

export type StreamStatus =
  | 'connecting'
  | 'streaming'
  | 'complete'
  | 'failed'
  | 'disconnected';

export interface UseGraphStreamResult {
  state: GraphState;
  status: StreamStatus;
}

/**
 * Subscribes to /api/applications/[id]/stream, parses each frame through
 * the shared schema, and reduces it into a GraphState. Returns the
 * current state and a coarse stream status.
 *
 * Terminal events (orchestrator.complete, orchestrator.failed,
 * already_complete) close the EventSource. Disconnects flip status to
 * 'disconnected' so the parent can show a banner — automatic
 * exponential backoff is deuda slice 9+ per ADR-0009.
 */
export function useGraphStream(applicationId: string): UseGraphStreamResult {
  const [state, dispatch] = useReducer(reduce, initialGraphState());
  const [status, setStatus] = useState<StreamStatus>('connecting');

  useEffect(() => {
    const url = `/api/applications/${applicationId}/stream`;
    const es = new EventSource(url);

    es.onopen = () => setStatus('streaming');
    es.onmessage = (event) => {
      applyFrame(event.data, (parsed) => {
        dispatch(parsed);
        if (
          parsed.kind === 'orchestrator.complete' ||
          parsed.kind === 'already_complete'
        ) {
          setStatus('complete');
          es.close();
        } else if (parsed.kind === 'orchestrator.failed') {
          setStatus('failed');
          es.close();
        }
      });
    };
    es.onerror = () => {
      // EventSource auto-retries; flip status so UI can react. If the stream
      // already closed (terminal event arrived), keep the terminal status.
      setStatus((prev) =>
        prev === 'complete' || prev === 'failed' ? prev : 'disconnected',
      );
    };

    return () => {
      es.close();
    };
  }, [applicationId]);

  return { state, status };
}
