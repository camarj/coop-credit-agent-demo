import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { intakeService } from '@/services/intake';
import { runOrchestrator, defaultPipeline } from '@/orchestrator';
import { ConsoleTracer } from '@/lib/tracer';
import { OperationalError, DomainError } from '@/lib/errors';
import { db } from '@/db/client';
import { applicationStates } from '@/db/schema';
import { bootstrapAgentDeps } from './_bootstrap';

const tracer = new ConsoleTracer();

async function readLatestVersion(applicationId: string): Promise<number> {
  const [row] = await db
    .select({ version: applicationStates.version })
    .from(applicationStates)
    .where(eq(applicationStates.applicationId, applicationId))
    .orderBy(desc(applicationStates.version))
    .limit(1);
  return row?.version ?? 0;
}

export async function POST(request: Request): Promise<Response> {
  bootstrapAgentDeps();
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
    await runOrchestrator(applicationId, { tracer }, defaultPipeline);
    const version = await readLatestVersion(applicationId);
    return NextResponse.json({ applicationId, version });
  } catch (err) {
    // Pipeline halted mid-flight (Operational or Domain error). Application
    // is left at whatever version was last successfully persisted; client
    // navigates to the state page where the gap is visible.
    if (err instanceof OperationalError || err instanceof DomainError) {
      const version = await readLatestVersion(applicationId);
      return NextResponse.json({ applicationId, version });
    }
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
