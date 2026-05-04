import type { Agent, ExecCtx, FullState } from '@/agents/_base/types';
import {
  getIessClient,
  getBreakerSnapshot,
} from '@/services/mocks/iess';
import {
  incomeInputSchema,
  incomeOutputSchema,
  type IncomeInput,
  type IncomeOutput,
} from './schema';

export const incomeAgent: Agent<IncomeInput, IncomeOutput> = {
  name: 'income',
  inputSchema: incomeInputSchema,
  outputSchema: incomeOutputSchema,

  selectInput: (state: FullState): IncomeInput => ({
    cedula: state.cedula,
  }),

  async execute(input: IncomeInput, ctx: ExecCtx): Promise<IncomeOutput> {
    return ctx.tracer.span(
      'income.execute',
      { agent: 'income' },
      async (span) => {
        const client = getIessClient();
        const employment = await client.getEmployment(input.cedula);

        const snapshot = getBreakerSnapshot();
        span.setAttribute('breaker.state', snapshot.state);
        span.setAttribute('breaker.failureCount', snapshot.failureCount);

        return {
          employer: employment.employer,
          salary: employment.salary,
          monthsActive: employment.monthsActive,
        };
      },
    );
  },
};
