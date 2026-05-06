export {
  decisionAgent,
  __setLlmForTesting,
  __setPolicyChunkLookupForTesting,
  __resetForTesting,
  ensureDeps,
} from './internal/agent';
export {
  computeConfidence,
  APPROVAL_THRESHOLD,
} from './internal/confidence';
export { preDecide } from './internal/preDecide';
export {
  decisionInputSchema,
  decisionOutputSchema,
  type DecisionInput,
  type DecisionOutput,
  type HardRejectOutput,
  type LlmDecisionOutput,
} from './internal/schema';
export type { SignalContribution, AuthoritativeSource } from './internal/types';
