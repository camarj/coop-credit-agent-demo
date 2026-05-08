export const PIPELINE_NODES = [
  'identity',
  'income',
  'bureau',
  'alt_score',
  'policy',
  'decision',
] as const;

export type AgentName = (typeof PIPELINE_NODES)[number];
