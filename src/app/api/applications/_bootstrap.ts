import { readFileSync } from 'node:fs';
import path from 'node:path';
import { db } from '@/db/client';
import { ensureDeps as ensurePolicyDeps } from '@/agents/policy';
import { ensureDeps as ensureDecisionDeps } from '@/agents/decision';
import { createRAGRetriever } from '@/lib/rag/retriever';
import { createOpenAIEmbedClient } from '@/lib/rag/embed-client';
import { createLlmClient } from '@/lib/llm';
import { parsePolicyCorpus } from '@/lib/rag/parser';

function loadPolicyChunkLookup(): Map<string, { ruleId: string; fullText: string }> {
  try {
    const corpusPath = path.resolve(process.cwd(), 'docs/policy/cooperativa-policy.md');
    const source = readFileSync(corpusPath, 'utf-8');
    const chunks = parsePolicyCorpus(source);
    return new Map(chunks.map((c) => [c.ruleId, { ruleId: c.ruleId, fullText: c.fullText }]));
  } catch {
    return new Map();
  }
}

export function bootstrapAgentDeps(): void {
  ensurePolicyDeps(() => ({
    retriever: createRAGRetriever({
      db,
      embedClient: createOpenAIEmbedClient({ apiKey: process.env.OPENAI_API_KEY ?? '' }),
    }),
    llm: createLlmClient({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' }),
  }));
  ensureDecisionDeps({
    llmFactory: () => createLlmClient({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' }),
    chunksFactory: () => loadPolicyChunkLookup(),
  });
}
