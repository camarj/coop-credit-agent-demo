import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { applications, applicationStates } from '@/db/schema';
import { runOrchestrator, defaultPipeline } from '@/orchestrator';
import { createBroadcastTracer, type Emit } from '@/lib/streaming/broadcast-tracer';
import type { StreamEvent } from '@/lib/streaming/event-schema';
import { bootstrapAgentDeps } from '../../_bootstrap';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TERMINAL_AGENTS = new Set(['decision', 'orchestrator']);

async function isApplicationTerminal(applicationId: string): Promise<boolean> {
  const rows = await db
    .select({ createdByAgent: applicationStates.createdByAgent })
    .from(applicationStates)
    .where(eq(applicationStates.applicationId, applicationId));
  return rows.some((r) => TERMINAL_AGENTS.has(r.createdByAgent));
}

async function applicationExists(applicationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: applications.id })
    .from(applications)
    .where(eq(applications.id, applicationId))
    .limit(1);
  return Boolean(row);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: applicationId } = await params;
  if (!UUID_REGEX.test(applicationId)) {
    return new Response('invalid_id', { status: 400 });
  }
  if (!(await applicationExists(applicationId))) {
    return new Response('not_found', { status: 404 });
  }

  bootstrapAgentDeps();
  const terminal = await isApplicationTerminal(applicationId);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit: Emit = (event: StreamEvent) => {
        if (controller.desiredSize !== null && controller.desiredSize <= 0) {
          // Backpressure: drop silently. Postgres remains the source of truth;
          // <PersistedView> reconstructs from rows on refresh.
          return;
        }
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Controller closed (client disconnected, abort, etc.).
        }
      };

      if (terminal) {
        emit({ kind: 'already_complete', version: 1, at: Date.now() });
        controller.close();
        return;
      }

      const tracer = createBroadcastTracer(emit);
      try {
        await runOrchestrator(applicationId, { tracer }, defaultPipeline);
        emit({ kind: 'orchestrator.complete', version: 1, at: Date.now() });
      } catch (err) {
        emit({
          kind: 'orchestrator.failed',
          version: 1,
          at: Date.now(),
          reason: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
