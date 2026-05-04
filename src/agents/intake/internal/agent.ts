import { db } from '@/db/client';
import { applications, applicationStates } from '@/db/schema';
import type { Tracer } from '@/lib/tracer';
import { intakeInputSchema, type IntakeInput } from './schema';

export interface AgentContext {
  tracer: Tracer;
}

export interface IntakeAgentOutput {
  applicationId: string;
  version: number;
  createdByAgent: 'intake';
  data: IntakeInput;
}

export const intakeAgent = {
  name: 'intake' as const,
  inputSchema: intakeInputSchema,

  async execute(
    input: unknown,
    ctx: AgentContext,
  ): Promise<IntakeAgentOutput> {
    return ctx.tracer.span(
      'intake.execute',
      { agent: 'intake' },
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
              data: validated,
            })
            .returning();

          return {
            applicationId: app.id,
            version: state.version,
            createdByAgent: 'intake' as const,
            data: validated,
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
