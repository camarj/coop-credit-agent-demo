import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { intakeService } from '@/services/intake';
import { runOrchestrator } from '@/orchestrator';
import { ConsoleTracer } from '@/lib/tracer';
import { OperationalError, DomainError } from '@/lib/errors';

const tracer = new ConsoleTracer();

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

  let applicationId: string;
  try {
    const state = await intakeService.execute(body, { tracer });
    applicationId = state.applicationId;
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'invalid_input', details: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }

  try {
    await runOrchestrator(applicationId, { tracer });
    return NextResponse.json({ applicationId, version: 1 });
  } catch (err) {
    // Application stays at v0; the page will render whatever exists.
    // Return 200 with applicationId so the client navigates to the state page,
    // where the failure is visible (last version < expected).
    if (err instanceof OperationalError || err instanceof DomainError) {
      return NextResponse.json({ applicationId, version: 0 });
    }
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
