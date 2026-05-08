import type { z } from 'zod';
import type { Tracer } from '@/lib/tracer';

/**
 * FullState is the reconstructed state of an Application — built by
 * merging every `application_states.contribution` row in version order.
 * Intake writes flat (cedula, ingresos, monto, plazo); every other
 * agent namespaces under its name. See ADR-0004.
 */
export interface FullState {
  // Intake (always present once v0 is persisted)
  cedula: string;
  ingresos: number;
  monto: number;
  plazo: number;

  // Agent contributions — appear after their corresponding agent runs
  identity?: {
    name: string;
    birthDate: string;
    valid: boolean;
  };
  income?: {
    employer: string;
    salary: number;
    monthsActive: number;
  };
  bureau?: {
    score: number;
    history: Array<{ at: number; source: string }>;
    hardInquiriesCount: number;
  };
  alt_score?: {
    score: number;
    signals: string[];
  };
  policy?: {
    applies: string[]; // rule IDs (e.g., 'MIC-001')
    notes: string;
  };
  decision?: {
    decision: 'APPROVED' | 'REJECTED' | 'REVIEW';
    decisionType: 'hard_reject' | 'llm_decision';
    confidence: number;
    llmBypassed: boolean;
    reason: string;
    citedRules: string[];
    // Hard reject only:
    triggeredBy?: {
      field: string;
      source: 'registro_civil' | 'iess' | 'bureau' | 'derived';
      value: unknown;
      computed?: Record<string, unknown>;
    };
    // LLM decision only:
    breakdown?: Array<{
      signal: string;
      weight: number;
      rawValue: number | null;
      contribution: number;
      weighted: number;
    }>;
    modelRequested?: string;
    modelActual?: string;
    degraded?: boolean;
  };

  /**
   * Reserved namespace owned by the orchestrator (not by an agent).
   * Populated when a saga walk-back compensates one or more agents.
   * The double-underscore prefix marks orchestrator metadata vs. agent
   * contributions. See ADR-0005 and ADR-0009 §"Cross-cutting".
   *
   * `type: 'saga'` is the discriminator used by `deriveMode(states)` so
   * future orchestrator-owned rows (e.g. token_budget_exceeded in slice 9+)
   * are distinguished without renaming.
   */
  __saga?: {
    type: 'saga';
    failedAgent: string;
    failedAt: string;
    compensatedAgents: string[];
    reason: string;
    completedAt: string;
  };

  /**
   * Sibling of __saga for the case where a pipeline failed before any
   * agent persisted side effects. There is nothing to compensate, but
   * the run still needs a terminal marker so deriveMode and the GET
   * stream's terminality check can tell "not started" from "finished
   * without saga". See ADR-0009 §"Cross-cutting".
   */
  __pipeline_failure?: {
    type: 'pipeline_failure';
    failedAgent: string;
    failedAt: string;
    reason: string;
    completedAt: string;
  };
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Optional callback invoked by agents that call the LLM. The orchestrator
 * collects the published usages and persists them in batch to
 * `application_token_usage`. Tests pass `undefined` and the agent skips
 * the publication. See ADR-0008 section 9.
 */
export type OnLlmCall = (agentName: string, usage: TokenUsage) => void;

export interface ExecCtx {
  tracer: Tracer;
  onLlmCall?: OnLlmCall;
}

/**
 * Agent is the contract for a node in the orchestration graph. Each agent
 * declares its minimal dependency on FullState via `selectInput`, the
 * Zod schemas that bound its IO, and the side-effecting work in `execute`.
 *
 * IntakeService does NOT implement this interface — it is a factory that
 * runs before the orchestrator. See ADR-0004.
 */
export interface Agent<TInput, TOutput> {
  name: string;
  inputSchema: z.ZodSchema<TInput>;
  outputSchema: z.ZodSchema<TOutput>;
  selectInput: (state: FullState) => TInput;
  execute: (input: TInput, ctx: ExecCtx) => Promise<TOutput>;
  compensate?: (input: TInput, ctx: ExecCtx) => Promise<void>;
}
