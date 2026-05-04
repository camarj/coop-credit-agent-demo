import { db } from '@/db/client';
import { applications, applicationStates } from '@/db/schema';
import type { Tracer } from '@/lib/tracer';
import { intakeInputSchema, type IntakeInput } from './schema';

export interface ServiceContext {
  tracer: Tracer;
}

export interface IntakeServiceOutput {
  applicationId: string;
  version: number;
  createdByAgent: 'intake';
  contribution: IntakeInput;
}

/**
 * IntakeService is the factory that creates an Application + state v0.
 * It is NOT a graph node — the orchestrator runs after intake completes,
 * starting from state v0 already persisted. See ADR-0004.
 */
export const intakeService = {
  name: 'intake' as const,
  inputSchema: intakeInputSchema,

  async execute(
    input: unknown,
    ctx: ServiceContext,
  ): Promise<IntakeServiceOutput> {
    return ctx.tracer.span(
      'intake.execute',
      { service: 'intake' },
      async (span) => {
        span.addEvent('intake.start');

        const validated = intakeInputSchema.parse(input);
        span.addEvent('schema.validated', { fields: 4 });

        const result = await db.transaction(async (tx) => {
          const [app] = await tx
            .insert(applications)
            .values({})
            .returning();
          const [state] = await tx
            .insert(applicationStates)
            .values({
              applicationId: app.id,
              version: 0,
              createdByAgent: 'intake',
              contribution: validated,
            })
            .returning();

          return {
            applicationId: app.id,
            version: state.version,
            createdByAgent: 'intake' as const,
            contribution: validated,
          };
        });

        span.setAttribute('applicationId', result.applicationId);
        span.setAttribute('version', result.version);
        span.addEvent('intake.complete');

        return result;
      },
    );
  },
};
