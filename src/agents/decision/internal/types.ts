/**
 * Pure TS types that don't need runtime Zod validation. Inputs and outputs
 * that DO need runtime validation live in `./schema.ts` (Zod-derived).
 */

export type AuthoritativeSource =
  | 'registro_civil'
  | 'iess'
  | 'bureau'
  | 'derived';

export interface SignalContribution {
  signal: string;
  weight: number;
  rawValue: number | null;
  contribution: number;
  weighted: number;
}

export interface ConfidenceResult {
  value: number;
  breakdown: SignalContribution[];
}

// Re-export from schema.ts for convenience — single source of truth lives there.
export type {
  DecisionInput,
  DecisionOutput,
  HardRejectOutput,
  LlmDecisionOutput,
  LlmRawOutput,
} from './schema';
