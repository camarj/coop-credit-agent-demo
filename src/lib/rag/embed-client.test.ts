import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createOpenAIEmbedClient } from './embed-client';

const mockCreate = vi.fn();
const fakeOpenAI = { embeddings: { create: mockCreate } };

beforeEach(() => {
  mockCreate.mockReset();
});

function buildOkResponse(vectors: number[][]) {
  return {
    object: 'list',
    data: vectors.map((vec, i) => ({
      object: 'embedding',
      index: i,
      embedding: vec,
    })),
    model: 'text-embedding-3-small',
    usage: { prompt_tokens: 10, total_tokens: 10 },
  };
}

describe('OpenAIEmbedClient — embed', () => {
  it('forwards a single text and returns its 1536-dim vector', async () => {
    const fakeVec = Array.from({ length: 1536 }, (_, i) => i / 1536);
    mockCreate.mockResolvedValue(buildOkResponse([fakeVec]));

    const client = createOpenAIEmbedClient({ client: fakeOpenAI as never });
    const result = await client.embed(['solicitante autonomo']);

    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(1536);
    expect(result[0]).toEqual(fakeVec);

    expect(mockCreate).toHaveBeenCalledOnce();
    const call = mockCreate.mock.calls[0][0];
    expect(call.model).toBe('text-embedding-3-small');
    expect(call.input).toEqual(['solicitante autonomo']);
  });

  it('forwards multiple texts in one batch and preserves order', async () => {
    const v1 = Array.from({ length: 1536 }, () => 0.1);
    const v2 = Array.from({ length: 1536 }, () => 0.2);
    const v3 = Array.from({ length: 1536 }, () => 0.3);
    mockCreate.mockResolvedValue(buildOkResponse([v1, v2, v3]));

    const client = createOpenAIEmbedClient({ client: fakeOpenAI as never });
    const result = await client.embed(['a', 'b', 'c']);

    expect(result).toHaveLength(3);
    expect(result[0][0]).toBeCloseTo(0.1);
    expect(result[1][0]).toBeCloseTo(0.2);
    expect(result[2][0]).toBeCloseTo(0.3);
  });

  it('throws when the API returns an unexpected vector dimension', async () => {
    const wrongDim = Array.from({ length: 512 }, () => 0);
    mockCreate.mockResolvedValue(buildOkResponse([wrongDim]));

    const client = createOpenAIEmbedClient({ client: fakeOpenAI as never });
    await expect(client.embed(['x'])).rejects.toThrow(/dimension/i);
  });

  it('throws when the API returns fewer vectors than inputs', async () => {
    const v1 = Array.from({ length: 1536 }, () => 0.1);
    mockCreate.mockResolvedValue(buildOkResponse([v1])); // only 1 returned

    const client = createOpenAIEmbedClient({ client: fakeOpenAI as never });
    await expect(client.embed(['a', 'b'])).rejects.toThrow(/count/i);
  });

  it('rejects empty input array — caller bug, not API bug', async () => {
    const client = createOpenAIEmbedClient({ client: fakeOpenAI as never });
    await expect(client.embed([])).rejects.toThrow(/empty/i);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('factory throws if neither apiKey nor client is provided', () => {
    expect(() => createOpenAIEmbedClient({})).toThrow(/apiKey/i);
  });
});
