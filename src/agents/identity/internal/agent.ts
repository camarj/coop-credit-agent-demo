import type { Agent, ExecCtx, FullState } from '@/agents/_base/types';
import {
  getRegistroCivilClient,
  getBreakerSnapshot,
} from '@/services/mocks/registro-civil';
import {
  identityInputSchema,
  identityOutputSchema,
  type IdentityInput,
  type IdentityOutput,
} from './schema';

export const identityAgent: Agent<IdentityInput, IdentityOutput> = {
  name: 'identity',
  inputSchema: identityInputSchema,
  outputSchema: identityOutputSchema,

  selectInput: (state: FullState): IdentityInput => ({
    cedula: state.cedula,
  }),

  async execute(input: IdentityInput, ctx: ExecCtx): Promise<IdentityOutput> {
    return ctx.tracer.span(
      'identity.execute',
      { agent: 'identity' },
      async (span) => {
        const client = getRegistroCivilClient();
        const person = await client.getPerson(input.cedula);

        span.setAttribute('breaker.state', getBreakerSnapshot().state);
        span.setAttribute('breaker.failureCount', getBreakerSnapshot().failureCount);

        return {
          name: person.name,
          birthDate: person.birthDate,
          valid: person.deathDate === undefined,
        };
      },
    );
  },
};
