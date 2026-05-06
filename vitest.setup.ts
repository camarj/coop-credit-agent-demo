import { beforeEach } from 'vitest';
import { config } from 'dotenv';

config({ path: '.env.local' });
config(); // .env fallback if .env.local is missing

// Default mock deps for policyAgent. Tests that exercise the agent
// directly (src/agents/policy/*.test.ts) override these via __setDepsForTesting.
// Tests downstream (orchestrator, route) inherit this happy-path stub so they
// don't have to know about RAG/LLM internals.
beforeEach(async () => {
  const { __setDepsForTesting } = await import('@/agents/policy');
  __setDepsForTesting({
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
});
