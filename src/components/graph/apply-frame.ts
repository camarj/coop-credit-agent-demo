import { streamEventSchema, type StreamEvent } from '@/lib/streaming/event-schema';

/**
 * Defensive boundary between the SSE wire and the reducer.
 * Pure: takes a raw `event.data` string from `EventSource.onmessage`,
 * parses + validates with Zod, dispatches only when valid. Malformed
 * JSON, unknown kinds, future versions and unknown agents are dropped
 * silently — invariant that an old client never crashes when a newer
 * server emits a frame variant it does not understand.
 */
export function applyFrame(
  raw: string,
  dispatch: (event: StreamEvent) => void,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  const result = streamEventSchema.safeParse(parsed);
  if (!result.success) return;
  dispatch(result.data);
}
