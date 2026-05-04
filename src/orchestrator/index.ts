import type { Agent, ExecCtx } from '@/agents/_base/types';
import { db } from '@/db/client';
import { applicationStates } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import {
  getLatestFullState,
  persistContribution,
} from '@/db/repository';
import { identityAgent } from '@/agents/identity';
import { incomeAgent } from '@/agents/income';
import { bureauAgent } from '@/agents/bureau';

/**
 * Type alias for an agent with concrete IO types erased — used when the
 * orchestrator handles a heterogeneous array of agents. Each agent still
 * enforces its own schemas at runtime (inputSchema.parse / outputSchema.parse)
 * so the relaxed compile-time bounds do not weaken the contract.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAgent = Agent<any, any>;

/**
 * The default pipeline used by the production POST route. Tests can pass
 * a different array (eg. with a failingTestAgent appended to exercise saga
 * walk-back) without contaminating the production API. See ADR-0005.
 */
export const defaultPipeline: AnyAgent[] = [
  identityAgent,
  incomeAgent,
  bureauAgent,
];

interface RanAgent {
  agent: AnyAgent;
  input: unknown;
}

async function nextVersion(applicationId: string): Promise<number> {
  const [row] = await db
    .select({ version: applicationStates.version })
    .from(applicationStates)
    .where(eq(applicationStates.applicationId, applicationId))
    .orderBy(desc(applicationStates.version))
    .limit(1);
  return (row?.version ?? -1) + 1;
}

async function runAgent<TInput, TOutput>(
  agent: Agent<TInput, TOutput>,
  applicationId: string,
  ctx: ExecCtx,
): Promise<{ input: TInput; output: TOutput }> {
  const state = await getLatestFullState(applicationId);
  const input = agent.inputSchema.parse(agent.selectInput(state));
  const output = agent.outputSchema.parse(await agent.execute(input, ctx));
  const version = await nextVersion(applicationId);
  await persistContribution(applicationId, {
    version,
    agentName: agent.name,
    contribution: output as object,
  });
  return { input, output };
}

async function walkBackSaga(
  ran: RanAgent[],
  reason: string,
  applicationId: string,
  ctx: ExecCtx,
): Promise<void> {
  const compensated: string[] = [];

  for (const entry of [...ran].reverse()) {
    if (!entry.agent.compensate) continue;
    try {
      await entry.agent.compensate(entry.input, ctx);
      compensated.push(entry.agent.name);
    } catch {
      // Compensation must not mask the original failure. Best-effort.
    }
  }

  if (compensated.length === 0) return;

  const version = await nextVersion(applicationId);
  await db.insert(applicationStates).values({
    applicationId,
    version,
    createdByAgent: 'orchestrator',
    contribution: {
      __saga: {
        compensated: compensated.reverse(), // chronological order
        reason,
        completedAt: new Date().toISOString(),
      },
    },
  });
}

/**
 * Slice 4 orchestrator: linear sequence with saga walk-back. Accepts an
 * arbitrary `agents` array, letting tests inject a failing agent after
 * `bureau` to exercise compensation. Production passes `defaultPipeline`.
 *
 * On failure: walks back through the agents that succeeded, calling
 * compensate() in reverse order. Persists a single __saga row only when
 * at least one compensate ran. Re-throws the original error.
 */
export async function runOrchestrator(
  applicationId: string,
  ctx: ExecCtx,
  agents: AnyAgent[],
): Promise<void> {
  return ctx.tracer.span(
    'orchestrator.run',
    { applicationId, pipelineSize: agents.length },
    async (span) => {
      span.addEvent('orchestrator.start');
      const ran: RanAgent[] = [];

      try {
        for (const agent of agents) {
          const { input } = await runAgent(agent, applicationId, ctx);
          ran.push({ agent, input });
        }
        span.addEvent('orchestrator.complete');
      } catch (err) {
        span.addEvent('orchestrator.failed', {
          reason: err instanceof Error ? err.message : String(err),
        });
        const reason =
          err instanceof Error
            ? `${err.constructor.name}: ${err.message}`
            : String(err);
        await walkBackSaga(ran, reason, applicationId, ctx);
        throw err;
      }
    },
  );
}
