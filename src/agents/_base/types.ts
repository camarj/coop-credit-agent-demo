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

  /**
   * Reserved namespace owned by the orchestrator (not by an agent).
   * Populated when a saga walk-back compensates one or more agents.
   * The double-underscore prefix marks orchestrator metadata vs. agent
   * contributions. See ADR-0005.
   */
  __saga?: {
    compensated: string[];
    reason: string;
    completedAt: string;
  };
}

export interface ExecCtx {
  tracer: Tracer;
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
