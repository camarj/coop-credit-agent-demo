import Anthropic from '@anthropic-ai/sdk';
import { OperationalError, DomainError } from '@/lib/errors';
import { createBreaker, type Breaker } from '@/lib/circuit-breaker';

export const MODEL_PRIMARY = 'claude-sonnet-4-6';
export const MODEL_FALLBACK = 'claude-haiku-4-5-20251001';

const FALLBACK_MAP: Record<string, string | undefined> = {
  [MODEL_PRIMARY]: MODEL_FALLBACK,
};

const BREAKER_OPTS = {
  failureThreshold: 3,
  cooldownMs: 30_000,
  halfOpenMaxCalls: 1,
  timeoutMs: 30_000,
};

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GenerateRequest {
  system: string;
  messages: LlmMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface GenerateResult {
  text: string;
  modelRequested: string;
  modelActual: string;
  degraded: boolean; // true when fallback was used
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface LlmClient {
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

export interface LlmClientOptions {
  apiKey?: string;
  /** Inject a custom Anthropic client (used by tests). */
  client?: Pick<Anthropic, 'messages'>;
}

export function createLlmClient(opts: LlmClientOptions): LlmClient {
  const anthropic =
    opts.client ?? new Anthropic({ apiKey: opts.apiKey ?? requireKey() });
  const breakers = new Map<string, Breaker>();

  function breakerFor(model: string): Breaker {
    let b = breakers.get(model);
    if (!b) {
      b = createBreaker(BREAKER_OPTS);
      breakers.set(model, b);
    }
    return b;
  }

  async function callOnce(
    model: string,
    req: GenerateRequest,
  ): Promise<{ text: string; usage: GenerateResult['usage'] }> {
    return breakerFor(model).call(async () => {
      try {
        const response = await anthropic.messages.create({
          model,
          system: req.system,
          messages: req.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          max_tokens: req.maxTokens ?? 1024,
          temperature: req.temperature ?? 0,
        });

        const textBlock = response.content.find(
          (b: { type: string }) => b.type === 'text',
        ) as { type: 'text'; text: string } | undefined;

        return {
          text: textBlock?.text ?? '',
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          },
        };
      } catch (err) {
        // Map Anthropic SDK errors to our error taxonomy.
        // 5xx + 529 (overloaded) + timeouts + network → operational (counts for breaker)
        // 4xx (auth, bad request) → domain (does not count, propagates)
        const status = (err as { status?: number }).status;
        if (status !== undefined) {
          if (status >= 500 || status === 529) {
            throw new OperationalError(`anthropic_${status}`);
          }
          if (status >= 400 && status < 500) {
            throw new DomainError(`anthropic_${status}`);
          }
        }
        // Unknown error class: assume operational so the breaker can absorb it.
        throw new OperationalError('anthropic_unknown');
      }
    });
  }

  return {
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const requested = req.model ?? MODEL_PRIMARY;
      const fallback = FALLBACK_MAP[requested];

      try {
        const { text, usage } = await callOnce(requested, req);
        return {
          text,
          modelRequested: requested,
          modelActual: requested,
          degraded: false,
          usage,
        };
      } catch (err) {
        // Only retry on operational failures, and only when a fallback exists.
        if (err instanceof OperationalError && fallback) {
          const { text, usage } = await callOnce(fallback, req);
          return {
            text,
            modelRequested: requested,
            modelActual: fallback,
            degraded: true,
            usage,
          };
        }
        throw err;
      }
    },
  };
}

function requireKey(): string {
  throw new Error(
    'createLlmClient: pass `apiKey` or `client` (got neither)',
  );
}
