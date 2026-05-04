import type { Agent, ExecCtx, FullState } from '@/agents/_base/types';
import {
  getEquifaxClient,
  getBreakerSnapshot,
} from '@/services/mocks/equifax';
import {
  bureauInputSchema,
  bureauOutputSchema,
  type BureauInput,
  type BureauOutput,
} from './schema';

export const bureauAgent: Agent<BureauInput, BureauOutput> = {
  name: 'bureau',
  inputSchema: bureauInputSchema,
  outputSchema: bureauOutputSchema,

  selectInput: (state: FullState): BureauInput => ({
    cedula: state.cedula,
  }),

  async execute(input: BureauInput, ctx: ExecCtx): Promise<BureauOutput> {
    return ctx.tracer.span(
      'bureau.execute',
      { agent: 'bureau' },
      async (span) => {
        const client = getEquifaxClient();
        const report = await client.requestHardPull(input.cedula);

        const snapshot = getBreakerSnapshot();
        span.setAttribute('breaker.state', snapshot.state);
        span.setAttribute('breaker.failureCount', snapshot.failureCount);
        span.setAttribute('hardInquiriesCount', report.hardInquiriesCount);
        span.setAttribute('score', report.score);

        return report;
      },
    );
  },

  async compensate(input: BureauInput, ctx: ExecCtx): Promise<void> {
    return ctx.tracer.span(
      'bureau.compensate',
      { agent: 'bureau' },
      async (span) => {
        const client = getEquifaxClient();
        await client.removeLastHardInquiry(input.cedula);
        span.addEvent('hard_inquiry.removed');
      },
    );
  },
};
