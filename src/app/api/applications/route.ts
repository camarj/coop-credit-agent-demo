import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { intakeService } from '@/services/intake';
import { ConsoleTracer } from '@/lib/tracer';

const tracer = new ConsoleTracer();

/**
 * Slice 8 V1 cutover: POST persists only v0 (intake). The orchestrator runs
 * on the GET stream endpoint inside a ReadableStream — see ADR-0009 §V1.
 * The client redirects to /applications/[id], the page.tsx detects 'live'
 * mode via deriveMode(), and <LiveView> opens the SSE stream which executes
 * the pipeline. Single source of truth: orchestrator runs in exactly one place.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_input', details: 'request body is not valid JSON' },
      { status: 400 },
    );
  }

  try {
    const state = await intakeService.execute(body, { tracer });
    return NextResponse.json({ applicationId: state.applicationId });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'invalid_input', details: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
