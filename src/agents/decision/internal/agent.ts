import type { Agent, ExecCtx, FullState } from '@/agents/_base/types';
import { z } from 'zod';
import type { LlmClient } from '@/lib/llm';
import { DomainError } from '@/lib/errors';
import { computeConfidence, APPROVAL_THRESHOLD } from './confidence';
import { preDecide } from './preDecide';
import {
  decisionInputSchema,
  decisionOutputSchema,
  llmRawOutputSchema,
  type DecisionInput,
  type DecisionOutput,
} from './schema';
import {
  SYSTEM_PROMPT,
  buildUserMessage,
  cannedReasonForBucket,
  getBucket,
} from './prompt';

/**
 * Lookup table for policy chunks: ruleId → fullText. Populated at runtime
 * (or in tests) from the corpus markdown — the LLM needs the fullText to
 * cite rules with context. See ADR-0008 section 8.
 */
interface PolicyChunkLookup {
  ruleId: string;
  fullText: string;
}

let llm: LlmClient | undefined;
let policyChunkLookup: Map<string, PolicyChunkLookup> = new Map();

export function __setLlmForTesting(next: LlmClient): void {
  llm = next;
}

export function __setPolicyChunkLookupForTesting(
  next: Map<string, PolicyChunkLookup>,
): void {
  policyChunkLookup = next;
}

export function __resetForTesting(): void {
  llm = undefined;
  policyChunkLookup = new Map();
}

/**
 * Idempotent runtime initialization. Mirrors the pattern from policyAgent:
 * tests inject via __setLlmForTesting, runtime calls ensureDeps with a
 * factory that creates the real LlmClient + loads the corpus chunks.
 */
export function ensureDeps(deps: {
  llmFactory: () => LlmClient;
  chunksFactory: () => Map<string, PolicyChunkLookup>;
}): void {
  if (!llm) llm = deps.llmFactory();
  if (policyChunkLookup.size === 0) policyChunkLookup = deps.chunksFactory();
}

function getLlm(): LlmClient {
  if (!llm) {
    throw new Error(
      'decisionAgent: LlmClient not initialized — call __setLlmForTesting (tests) or ensureDeps (runtime)',
    );
  }
  return llm;
}

const TEMPERATURE = 0.3;
const MAX_TOKENS = 200;

/**
 * Validates that every rule cited by the LLM is in the upstream policy.applies.
 * If the LLM invents a rule (hallucination), throw DomainError so the orchestrator
 * sees a clear failure rather than persisting fabricated metadata.
 */
function validateCitedRules(
  citedRules: string[],
  policyApplies: string[] | undefined,
): void {
  const allowed = new Set(policyApplies ?? []);
  for (const rule of citedRules) {
    if (!allowed.has(rule)) {
      throw new DomainError(
        `citedRules contains "${rule}" not present in policy.applies (${[...allowed].join(', ') || 'empty'})`,
      );
    }
  }
}

export const decisionAgent: Agent<DecisionInput, DecisionOutput> = {
  name: 'decision',
  inputSchema: decisionInputSchema,
  outputSchema: decisionOutputSchema,

  selectInput: (state: FullState): DecisionInput => ({
    cedula: state.cedula,
    ingresos: state.ingresos,
    monto: state.monto,
    plazo: state.plazo,
    identity: state.identity,
    income: state.income,
    bureau: state.bureau
      ? {
          score: state.bureau.score,
          hardInquiriesCount: state.bureau.hardInquiriesCount,
          history: state.bureau.history,
        }
      : undefined,
    alt_score: state.alt_score,
    policy: state.policy,
  }),

  async execute(input: DecisionInput, ctx: ExecCtx): Promise<DecisionOutput> {
    return ctx.tracer.span(
      'decision.execute',
      { agent: 'decision' },
      async (span) => {
        // Phase 1: hard rejects deterministicos. Bypass LLM completamente.
        const hardReject = preDecide(input);
        if (hardReject) {
          span.setAttribute('decision.type', 'hard_reject');
          span.setAttribute('decision.value', hardReject.decision);
          span.setAttribute('confidence', hardReject.confidence);
          span.setAttribute('cited_rule', hardReject.citedRules[0]);
          span.setAttribute('llm.bypassed', true);
          return hardReject;
        }

        // Phase 2: confidence deterministico.
        const confidenceResult = computeConfidence(input);
        const decision = confidenceResult.value >= APPROVAL_THRESHOLD ? 'APPROVED' : 'REVIEW';
        const bucket = getBucket(decision, confidenceResult.value);

        span.setAttribute('decision.type', 'llm_decision');
        span.setAttribute('decision.value', decision);
        span.setAttribute('confidence', confidenceResult.value);
        span.setAttribute('decision.bucket', bucket);

        // Phase 3: LLM redacta el reason (no la decision, no el confidence).
        const policyChunks = (input.policy?.applies ?? []).flatMap((ruleId) => {
          const chunk = policyChunkLookup.get(ruleId);
          return chunk ? [chunk] : [];
        });

        const userMessage = buildUserMessage(
          input,
          confidenceResult,
          decision,
          APPROVAL_THRESHOLD,
          policyChunks,
        );

        const llmResult = await getLlm().generate({
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
          temperature: TEMPERATURE,
          maxTokens: MAX_TOKENS,
        });

        ctx.onLlmCall?.('decision', llmResult.usage);

        span.setAttribute('llm.model.requested', llmResult.modelRequested);
        span.setAttribute('llm.model.actual', llmResult.modelActual);
        span.setAttribute('llm.degraded', llmResult.degraded);
        span.setAttribute('llm.tokens.input', llmResult.usage.inputTokens);
        span.setAttribute('llm.tokens.output', llmResult.usage.outputTokens);

        // Parse + validate. On failure, fall back to canned reason +
        // mark degraded:true. Do NOT propagate OperationalError — the
        // deterministic decision/confidence are still valid output.
        let reason: string;
        let citedRules: string[];
        let degradedFromFallback = false;
        try {
          const cleaned = llmResult.text
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/```\s*$/i, '')
            .trim();
          const parsed = JSON.parse(cleaned);
          const validated = llmRawOutputSchema.parse(parsed);
          validateCitedRules(validated.citedRules, input.policy?.applies);
          reason = validated.reason;
          citedRules = validated.citedRules;
        } catch (err) {
          // citedRules unknown → DomainError propagates (real bug, not fallback case)
          if (err instanceof DomainError) throw err;
          // JSON parse error or Zod validation (length, shape) → canned fallback
          if (err instanceof z.ZodError || err instanceof SyntaxError) {
            reason = cannedReasonForBucket(decision, confidenceResult.value);
            citedRules = [];
            degradedFromFallback = true;
            span.setAttribute('llm.fallback_to_canned', true);
          } else {
            throw err;
          }
        }

        const finalDegraded = llmResult.degraded || degradedFromFallback;
        span.setAttribute('llm.degraded.final', finalDegraded);

        return {
          decision,
          decisionType: 'llm_decision',
          confidence: confidenceResult.value,
          llmBypassed: false,
          breakdown: confidenceResult.breakdown,
          reason,
          citedRules,
          modelRequested: llmResult.modelRequested,
          modelActual: llmResult.modelActual,
          degraded: finalDegraded,
        };
      },
    );
  },
};
