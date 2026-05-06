import type { Agent, ExecCtx, FullState } from '@/agents/_base/types';
import { DomainError } from '@/lib/errors';
import type { RAGRetriever } from '@/lib/rag/retriever';
import type { LlmClient } from '@/lib/llm';
import type { RetrievedChunk } from '@/lib/rag/types';
import {
  policyInputSchema,
  policyOutputSchema,
  type PolicyInput,
  type PolicyOutput,
} from './schema';

const RETRIEVAL_K = 5;
const SYSTEM_PROMPT = `Eres un evaluador de politica de credito de una cooperativa de ahorro y credito ecuatoriana.

Recibes:
1. Un PERFIL del solicitante (datos de identidad, IESS, bureau, score alternativo)
2. Un conjunto de REGLAS RELEVANTES recuperadas del manual de politica

Tu tarea: identificar EXACTAMENTE cuales de las reglas recibidas APLICAN al perfil. Solo incluye reglas cuya condicion se cumple claramente con los datos del perfil. Si no estas seguro, NO la incluyas.

Responde con JSON estricto, sin markdown, sin texto adicional, en este shape exacto:
{
  "applies": ["MIC-001", "GAR-002"],
  "notes": "explicacion breve en una o dos frases sobre por que esas reglas aplican"
}

Si ninguna regla aplica, devuelve { "applies": [], "notes": "..." }.`;

interface PolicyDeps {
  retriever: RAGRetriever;
  llm: LlmClient;
}

let deps: PolicyDeps | undefined;

export function __setDepsForTesting(next: PolicyDeps): void {
  deps = next;
}

export function __resetForTesting(): void {
  deps = undefined;
}

/**
 * Idempotent runtime initialization. If deps are already set (typically by
 * tests via __setDepsForTesting), this is a no-op. Otherwise the factory
 * runs and stores the result.
 */
export function ensureDeps(factory: () => PolicyDeps): void {
  if (!deps) deps = factory();
}

function getDeps(): PolicyDeps {
  if (!deps) {
    throw new Error(
      'policyAgent dependencies not initialized — call __setDepsForTesting (tests) or ensureDeps (runtime)',
    );
  }
  return deps;
}

/**
 * Builds a single natural-language string used as the retrieval query.
 * Keeps the input shape decoupled from the embedding model — the query
 * looks like prose a human would type asking the system for guidance.
 */
export function buildRetrievalQuery(input: PolicyInput): string {
  const parts: string[] = [];
  parts.push(`Solicitante con cedula ${input.cedula}.`);
  parts.push(`Monto solicitado USD ${input.monto}, plazo ${input.plazo} meses.`);
  parts.push(`Ingreso declarado USD ${input.ingresos}.`);

  if (input.identity) {
    parts.push(
      input.identity.valid
        ? `Identidad valida: ${input.identity.name}, nacimiento ${input.identity.birthDate}.`
        : `Identidad invalida (persona fallecida).`,
    );
  }

  if (input.income) {
    parts.push(
      `Empleador ${input.income.employer}, salario IESS USD ${input.income.salary}, antiguedad ${input.income.monthsActive} meses.`,
    );
  } else if (input.identity) {
    parts.push('Sin afiliacion al IESS (autonomo).');
  }

  if (input.bureau) {
    parts.push(
      `Score Equifax ${input.bureau.score}, hard inquiries ${input.bureau.hardInquiriesCount}.`,
    );
  }

  if (input.alt_score) {
    parts.push(
      `Score alternativo ${input.alt_score.score} con senales: ${input.alt_score.signals.join(', ')}.`,
    );
  }

  return parts.join(' ');
}

function buildUserMessage(
  input: PolicyInput,
  rules: RetrievedChunk[],
): string {
  const profile = buildRetrievalQuery(input);
  const rulesSection = rules
    .map((r) => `${r.chunk.fullText}`)
    .join('\n\n');

  return `PERFIL:
${profile}

REGLAS RELEVANTES (top ${rules.length} por similitud semantica):

${rulesSection}

Devuelve el JSON ahora.`;
}

function parseAndValidateOutput(rawText: string): PolicyOutput {
  let parsed: unknown;
  try {
    // Some LLM responses wrap JSON in code fences despite instructions —
    // strip them defensively before parsing.
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new DomainError('llm_invalid_json');
  }

  const result = policyOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new DomainError('llm_invalid_shape');
  }
  return result.data;
}

export const policyAgent: Agent<PolicyInput, PolicyOutput> = {
  name: 'policy',
  inputSchema: policyInputSchema,
  outputSchema: policyOutputSchema,

  selectInput: (state: FullState): PolicyInput => ({
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
        }
      : undefined,
    alt_score: state.alt_score,
  }),

  async execute(
    input: PolicyInput,
    ctx: ExecCtx,
  ): Promise<PolicyOutput> {
    return ctx.tracer.span(
      'policy.execute',
      { agent: 'policy' },
      async (span) => {
        const { retriever, llm } = getDeps();

        const query = buildRetrievalQuery(input);
        const retrieved = await retriever.retrieve(query, RETRIEVAL_K);
        const reranked = await retriever.rerank(retrieved, query, RETRIEVAL_K);
        span.setAttribute('rag.chunks_retrieved', reranked.length);

        const userMessage = buildUserMessage(input, reranked);
        const llmResult = await llm.generate({
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
          maxTokens: 512,
          temperature: 0,
        });

        span.setAttribute('llm.model.requested', llmResult.modelRequested);
        span.setAttribute('llm.model.actual', llmResult.modelActual);
        span.setAttribute('llm.degraded', llmResult.degraded);
        span.setAttribute('llm.tokens.input', llmResult.usage.inputTokens);
        span.setAttribute('llm.tokens.output', llmResult.usage.outputTokens);

        // Token usage publication. Slice 7 (ADR-0008 sec 9): orchestrator
        // recolecta y persiste batch a application_token_usage. Tests del
        // policyAgent NO inyectan callback, asi que el call es no-op.
        ctx.onLlmCall?.('policy', llmResult.usage);

        const output = parseAndValidateOutput(llmResult.text);
        span.setAttribute('policy.applies_count', output.applies.length);
        return output;
      },
    );
  },
};
