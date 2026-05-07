import type {
  Agent,
  ExecCtx,
  TokenUsage,
  OnLlmCall,
} from '@/agents/_base/types';
import { db } from '@/db/client';
import { applicationStates, applicationTokenUsage } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import {
  getLatestFullState,
  persistContribution,
} from '@/db/repository';
import { identityAgent } from '@/agents/identity';
import { incomeAgent } from '@/agents/income';
import { bureauAgent } from '@/agents/bureau';
import { altScoreAgent } from '@/agents/alt_score';
import { policyAgent } from '@/agents/policy';
import { decisionAgent } from '@/agents/decision';

/**
 * Type alias for an agent with concrete IO types erased — used when the
 * orchestrator handles a heterogeneous array of agents. Each agent still
 * enforces its own schemas at runtime (inputSchema.parse / outputSchema.parse)
 * so the relaxed compile-time bounds do not weaken the contract.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAgent = Agent<any, any>;

/**
 * A pipeline step is either a single agent (serial) or an array of agents
 * to run in parallel. The orchestrator dispatches in exactly ONE place
 * (runStep) — adding more `Array.isArray` checks elsewhere is a smell.
 * See ADR-0006.
 */
export type PipelineStep = AnyAgent | AnyAgent[];
export type Pipeline = PipelineStep[];

export const defaultPipeline: Pipeline = [
  identityAgent,
  incomeAgent,
  [bureauAgent, altScoreAgent],
  policyAgent,
  decisionAgent,
];

interface RanAgent {
  agent: AnyAgent;
  input: unknown;
}

/** A step's ran agents, in the order they were declared in the array. */
type RanStep = RanAgent[];

async function nextVersion(applicationId: string): Promise<number> {
  const [row] = await db
    .select({ version: applicationStates.version })
    .from(applicationStates)
    .where(eq(applicationStates.applicationId, applicationId))
    .orderBy(desc(applicationStates.version))
    .limit(1);
  return (row?.version ?? -1) + 1;
}

async function executeAgent<TInput, TOutput>(
  agent: Agent<TInput, TOutput>,
  applicationId: string,
  version: number,
  ctx: ExecCtx,
): Promise<{ input: TInput; output: TOutput }> {
  const state = await getLatestFullState(applicationId);
  const input = agent.inputSchema.parse(agent.selectInput(state));
  const output = agent.outputSchema.parse(await agent.execute(input, ctx));
  await persistContribution(applicationId, {
    version,
    agentName: agent.name,
    contribution: output as object,
  });
  return { input, output };
}

/**
 * Runs a single pipeline step (serial or parallel). Returns the agents that
 * completed successfully along with their inputs (so compensate() can be
 * called later). Throws the first failure observed; if a parallel step had
 * multiple failures, the rest are dropped (best-effort original-error fidelity).
 *
 * Parallel rule: versions are pre-assigned by array order BEFORE Promise.allSettled
 * fires. So if `step = [bureau, altScore]` and current version is 2, bureau gets
 * 3 and altScore gets 4 — regardless of who finishes first in wall-clock time.
 * This is what the AC of issue #5 means by "agnostic to persistence order".
 */
async function runStep(
  step: PipelineStep,
  applicationId: string,
  ctx: ExecCtx,
): Promise<{ ran: RanStep; failure?: { agentName: string; error: unknown } }> {
  const agents = Array.isArray(step) ? step : [step];
  const baseVersion = await nextVersion(applicationId);

  const settled = await Promise.allSettled(
    agents.map((agent, i) =>
      executeAgent(agent, applicationId, baseVersion + i, ctx),
    ),
  );

  const ran: RanStep = [];
  let firstFailure: { agentName: string; error: unknown } | undefined;

  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      ran.push({ agent: agents[i], input: result.value.input });
    } else if (firstFailure === undefined) {
      firstFailure = { agentName: agents[i].name, error: result.reason };
    }
  });

  return { ran, failure: firstFailure };
}

async function compensateStep(step: RanStep, ctx: ExecCtx): Promise<string[]> {
  const compensated: string[] = [];
  // Within a parallel step, compensation order between siblings is irrelevant
  // — they had no causal dependency on each other. Run them concurrently.
  const settled = await Promise.allSettled(
    step.map(async (entry) => {
      if (!entry.agent.compensate) return null;
      await entry.agent.compensate(entry.input, ctx);
      return entry.agent.name;
    }),
  );
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value !== null) {
      compensated.push(r.value);
    }
    // Compensation failures are swallowed — must not mask original cause.
  }
  return compensated;
}

async function walkBackSaga(
  ranSteps: RanStep[],
  failedAgent: string,
  failedAt: string,
  reason: string,
  applicationId: string,
  ctx: ExecCtx,
): Promise<void> {
  const compensatedAgents: string[] = [];

  // LIFO across steps; intra-step parallel siblings compensate concurrently.
  for (const step of [...ranSteps].reverse()) {
    const stepCompensated = await compensateStep(step, ctx);
    compensatedAgents.push(...stepCompensated);
  }

  const version = await nextVersion(applicationId);
  const completedAt = new Date().toISOString();

  if (compensatedAgents.length === 0) {
    // Pipeline aborted before any agent persisted side effects. We still
    // mark a terminal row so deriveMode and the GET stream's terminality
    // check can distinguish "didn't run yet" from "ran and failed with
    // nothing to compensate". Without this row a refresh would loop the
    // GET stream back through the orchestrator. See ADR-0009 §V1.
    await db.insert(applicationStates).values({
      applicationId,
      version,
      createdByAgent: 'orchestrator',
      contribution: {
        __pipeline_failure: {
          type: 'pipeline_failure',
          failedAgent,
          failedAt,
          reason,
          completedAt,
        },
      },
    });
    return;
  }

  await db.insert(applicationStates).values({
    applicationId,
    version,
    createdByAgent: 'orchestrator',
    contribution: {
      __saga: {
        type: 'saga',
        failedAgent,
        failedAt,
        compensatedAgents,
        reason,
        completedAt,
      },
    },
  });
}

interface TokenUsageRecord {
  agentName: string;
  usage: TokenUsage;
}

async function persistTokenUsages(
  applicationId: string,
  records: TokenUsageRecord[],
): Promise<void> {
  if (records.length === 0) return;
  await db.insert(applicationTokenUsage).values(
    records.map((r) => ({
      applicationId,
      agentName: r.agentName,
      inputTokens: r.usage.inputTokens,
      outputTokens: r.usage.outputTokens,
    })),
  );
}

/**
 * Slice 7 orchestrator. Accepts a pipeline of steps where each step is a
 * single agent or an array of agents to run in parallel. On any failure,
 * walks back through completed steps (LIFO across steps, concurrent within
 * a parallel step), calling compensate() and persisting a __saga row.
 * Re-throws the original error.
 *
 * Token usage: a recorder collects each agent's `onLlmCall` publication and
 * persists the batch to `application_token_usage` at the end of the run
 * (success path). On failure paths the partial usages are still persisted
 * so audit trail is not lost. See ADR-0008 section 9.
 */
export async function runOrchestrator(
  applicationId: string,
  ctx: ExecCtx,
  pipeline: Pipeline,
): Promise<void> {
  return ctx.tracer.span(
    'orchestrator.run',
    { applicationId, steps: pipeline.length },
    async (span) => {
      span.addEvent('orchestrator.start');
      const ranSteps: RanStep[] = [];
      const tokenRecords: TokenUsageRecord[] = [];

      // Build a recorder that publishes into the local array. If the caller
      // provided their own onLlmCall, chain so external observers still see
      // each event (preserves Langfuse / metrics integrations downstream).
      const externalOnLlmCall = ctx.onLlmCall;
      const recordingOnLlmCall: OnLlmCall = (agentName, usage) => {
        tokenRecords.push({ agentName, usage });
        externalOnLlmCall?.(agentName, usage);
      };
      const ctxWithRecorder: ExecCtx = { ...ctx, onLlmCall: recordingOnLlmCall };

      let failedAgent: string | undefined;
      let failedAt: string | undefined;

      try {
        for (const step of pipeline) {
          const { ran, failure } = await runStep(
            step,
            applicationId,
            ctxWithRecorder,
          );
          if (failure) {
            ranSteps.push(ran); // partial successes still need compensation
            failedAgent = failure.agentName;
            failedAt = new Date().toISOString();
            span.addEvent('orchestrator.step_failed', {
              agent: failure.agentName,
            });
            throw failure.error;
          }
          ranSteps.push(ran);
        }

        await persistTokenUsages(applicationId, tokenRecords);
        const totalIn = tokenRecords.reduce(
          (s, r) => s + r.usage.inputTokens,
          0,
        );
        const totalOut = tokenRecords.reduce(
          (s, r) => s + r.usage.outputTokens,
          0,
        );
        span.setAttribute('tokens.total.input', totalIn);
        span.setAttribute('tokens.total.output', totalOut);
        span.setAttribute('tokens.total', totalIn + totalOut);
        span.addEvent('orchestrator.complete');
      } catch (err) {
        // Persist partial usages on failure too — audit trail does not lose
        // tokens just because pipeline aborted.
        await persistTokenUsages(applicationId, tokenRecords).catch(() => {
          // Persistence failure on saga path is swallowed so it does not mask
          // the original error.
        });

        const reason =
          err instanceof Error
            ? `${err.constructor.name}: ${err.message}`
            : String(err);
        await walkBackSaga(
          ranSteps,
          failedAgent ?? 'unknown',
          failedAt ?? new Date().toISOString(),
          reason,
          applicationId,
          ctxWithRecorder,
        );
        throw err;
      }
    },
  );
}
