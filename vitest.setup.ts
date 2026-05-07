import { beforeEach } from 'vitest';
import { config } from 'dotenv';

config({ path: '.env.local' });
config(); // .env fallback if .env.local is missing

// Tests never pay the demo-only artificial agent latency. Force to 0 even
// if .env.local has it set for dev demo runs.
process.env.DEMO_AGENT_DELAY_MS = '0';

// Default mock deps for policyAgent and decisionAgent. Tests that exercise
// the agents directly override these via __setDepsForTesting / __setLlmForTesting.
// Tests downstream (orchestrator, route) inherit happy-path stubs so they
// don't have to know about RAG/LLM internals.
beforeEach(async () => {
  const policyModule = await import('@/agents/policy');
  policyModule.__setDepsForTesting({
    retriever: {
      retrieve: async () => [],
      rerank: async () => [],
    },
    llm: {
      generate: async () => ({
        text: JSON.stringify({
          applies: ['MIC-003'],
          notes: 'mock policy decision',
        }),
        modelRequested: 'claude-sonnet-4-6',
        modelActual: 'claude-sonnet-4-6',
        degraded: false,
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    },
  });

  const decisionModule = await import('@/agents/decision');
  decisionModule.__resetForTesting();
  decisionModule.__setLlmForTesting({
    generate: async () => ({
      text: JSON.stringify({
        reason:
          'Mock reason desde vitest.setup — el LLM real solo se invoca en E2E.',
        citedRules: [],
      }),
      modelRequested: 'claude-sonnet-4-6',
      modelActual: 'claude-sonnet-4-6',
      degraded: false,
      usage: { inputTokens: 0, outputTokens: 0 },
    }),
  });
  decisionModule.__setPolicyChunkLookupForTesting(
    new Map([['MIC-003', { ruleId: 'MIC-003', fullText: '## Regla MIC-003' }]]),
  );
});
