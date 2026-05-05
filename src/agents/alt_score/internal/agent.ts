import type { Agent, ExecCtx, FullState } from '@/agents/_base/types';
import {
  getAltScoreClient,
  getBreakerSnapshot,
} from '@/services/mocks/score-alternativo';
import {
  altScoreInputSchema,
  altScoreOutputSchema,
  type AltScoreInput,
  type AltScoreOutput,
} from './schema';

export const altScoreAgent: Agent<AltScoreInput, AltScoreOutput> = {
  name: 'alt_score',
  inputSchema: altScoreInputSchema,
  outputSchema: altScoreOutputSchema,

  selectInput: (state: FullState): AltScoreInput => ({
    cedula: state.cedula,
  }),

  async execute(
    input: AltScoreInput,
    ctx: ExecCtx,
  ): Promise<AltScoreOutput> {
    return ctx.tracer.span(
      'alt_score.execute',
      { agent: 'alt_score' },
      async (span) => {
        const client = getAltScoreClient();
        const result = await client.getAltScore(input.cedula);

        const snapshot = getBreakerSnapshot();
        span.setAttribute('breaker.state', snapshot.state);
        span.setAttribute('breaker.failureCount', snapshot.failureCount);
        span.setAttribute('alt_score.value', result.score);

        return result;
      },
    );
  },
};
