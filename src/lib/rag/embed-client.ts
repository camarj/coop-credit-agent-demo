import OpenAI from 'openai';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Thin contract over the OpenAI embeddings API. Lives behind a typed
 * factory (`createOpenAIEmbedClient`) so tests can substitute a stub.
 *
 * `embed` accepts a batch (1..N strings) and returns vectors in the same
 * order. Validates the API response shape — dimension mismatch and count
 * mismatch are bugs we want to surface at ingest time, not silently
 * persist 512-dim vectors into a 1536-dim column and hit pgvector errors
 * at query time.
 */
export interface EmbedClient {
  embed(texts: string[]): Promise<number[][]>;
}

export interface EmbedClientOptions {
  apiKey?: string;
  /** Inject a custom OpenAI instance (used by tests). */
  client?: Pick<OpenAI, 'embeddings'>;
}

export function createOpenAIEmbedClient(opts: EmbedClientOptions): EmbedClient {
  const client =
    opts.client ?? new OpenAI({ apiKey: opts.apiKey ?? requireKey() });

  return {
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) {
        throw new Error(
          'EmbedClient.embed called with empty input array — caller must pass at least one text',
        );
      }

      const response = await client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: texts,
      });

      if (response.data.length !== texts.length) {
        throw new Error(
          `EmbedClient: count mismatch — sent ${texts.length} texts, got ${response.data.length} vectors`,
        );
      }

      const vectors = response.data.map((item) => item.embedding);

      for (const [i, vec] of vectors.entries()) {
        if (vec.length !== EMBEDDING_DIMENSIONS) {
          throw new Error(
            `EmbedClient: vector ${i} has dimension ${vec.length}, expected ${EMBEDDING_DIMENSIONS}`,
          );
        }
      }

      return vectors;
    },
  };
}

function requireKey(): string {
  throw new Error(
    'createOpenAIEmbedClient: pass `apiKey` or `client` (got neither)',
  );
}
