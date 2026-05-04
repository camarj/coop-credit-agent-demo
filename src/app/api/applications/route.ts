import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { intakeAgent } from '@/agents/intake';
import { ConsoleTracer } from '@/lib/tracer';

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

  try {
    const state = await intakeAgent.execute(body, { tracer });
    return NextResponse.json({
      applicationId: state.applicationId,
      version: state.version,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'invalid_input', details: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500 },
    );
  }
}
