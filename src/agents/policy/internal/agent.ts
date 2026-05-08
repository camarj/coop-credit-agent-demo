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
        const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
          { role: 'user', content: userMessage },
        ];

        // Up to 2 attempts. If the first response cannot be parsed/validated
        // (LLM occasionally returns malformed JSON or wrong shape), we feed
        // the bad response back with a corrective prompt and try once more.
        // If the second attempt also fails, we fall back to a canned output
        // with `policy.degraded=true` so the orchestrator's saga path is not
        // triggered for what is fundamentally a transient model glitch. The
        // decisionAgent downstream sees an empty `applies` and continues.
        let parsed: PolicyOutput | null = null;
        let lastError: unknown = null;
        let lastLlmResult: Awaited<ReturnType<typeof llm.generate>> | null = null;

        for (let attempt = 1; attempt <= 2; attempt++) {
          const llmResult = await llm.generate({
            system: SYSTEM_PROMPT,
            messages,
            maxTokens: 512,
            temperature: 0,
          });
          lastLlmResult = llmResult;
          ctx.onLlmCall?.('policy', llmResult.usage);

          try {
            parsed = parseAndValidateOutput(llmResult.text);
            span.setAttribute('policy.attempts', attempt);
            break;
          } catch (err) {
            lastError = err;
            if (attempt === 1) {
              span.addEvent('policy.parse_failed_retrying', {
                error: err instanceof Error ? err.message : String(err),
              });
              messages.push(
                { role: 'assistant', content: llmResult.text },
                {
                  role: 'user',
                  content:
                    'Tu respuesta anterior no fue JSON válido o no respeta el schema. Responde EXCLUSIVAMENTE con un objeto JSON válido siguiendo el schema {"applies": string[], "notes": string}. Sin texto adicional, sin explicaciones, sin code fences.',
                },
              );
            }
          }
        }

        if (lastLlmResult) {
          span.setAttribute('llm.model.requested', lastLlmResult.modelRequested);
          span.setAttribute('llm.model.actual', lastLlmResult.modelActual);
          span.setAttribute('llm.degraded', lastLlmResult.degraded);
          span.setAttribute('llm.tokens.input', lastLlmResult.usage.inputTokens);
          span.setAttribute('llm.tokens.output', lastLlmResult.usage.outputTokens);
        }

        if (parsed) {
          span.setAttribute('policy.applies_count', parsed.applies.length);
          span.setAttribute('policy.degraded', false);
          return parsed;
        }

        // Both attempts failed — fall back to canned output instead of
        // aborting the whole pipeline via saga.
        span.setAttribute('policy.attempts', 2);
        span.setAttribute('policy.degraded', true);
        span.addEvent('policy.parse_failed_fallback', {
          error: lastError instanceof Error ? lastError.message : String(lastError),
        });
        const canned: PolicyOutput = {
          applies: [],
          notes:
            'La evaluación de política no pudo completarse — el modelo devolvió output no parseable en dos intentos. La decisión continúa en modo degradado, sin contexto de reglas.',
        };
        span.setAttribute('policy.applies_count', 0);
        return canned;
      },
    );
  },
};
