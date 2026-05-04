import type { Agent, ExecCtx } from '@/agents/_base/types';
import {
  getLatestFullState,
  persistContribution,
} from '@/db/repository';
import { identityAgent } from '@/agents/identity';
import { incomeAgent } from '@/agents/income';

/**
 * Runs a single agent: read FullState → select → validate input → execute
 * → validate output → persist contribution namespaced under agent name.
 * Throws on any failure; the caller decides whether to halt or compensate.
 */
async function runAgent<TInput, TOutput>(
  agent: Agent<TInput, TOutput>,
  applicationId: string,
  version: number,
  ctx: ExecCtx,
): Promise<void> {
  const state = await getLatestFullState(applicationId);
  const input = agent.inputSchema.parse(agent.selectInput(state));
  const output = agent.outputSchema.parse(await agent.execute(input, ctx));
  await persistContribution(applicationId, {
    version,
    agentName: agent.name,
    contribution: output as object,
  });
}

/**
 * Slice 3 orchestrator: linear sequence intake → identity → income. State v0
 * must exist before this runs (created by IntakeService). LangGraph
 * integration arrives in slice 5 with the alt-score parallel branch.
 */
export async function runOrchestrator(
  applicationId: string,
  ctx: ExecCtx,
): Promise<void> {
  return ctx.tracer.span(
    'orchestrator.run',
    { applicationId },
    async (span) => {
      span.addEvent('orchestrator.start');
      await runAgent(identityAgent, applicationId, 1, ctx);
      await runAgent(incomeAgent, applicationId, 2, ctx);
      span.addEvent('orchestrator.complete');
    },
  );
}
