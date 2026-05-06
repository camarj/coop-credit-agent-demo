import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLlmClient, MODEL_PRIMARY, MODEL_FALLBACK } from './index';
import { OperationalError, DomainError } from '@/lib/errors';

const mockCreate = vi.fn();
const fakeAnthropic = { messages: { create: mockCreate } };

beforeEach(() => {
  mockCreate.mockReset();
});

function buildOkResponse(text: string, model: string) {
  return {
    id: 'msg_' + Math.random().toString(36).slice(2, 8),
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

class FakeAPIError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'APIError';
  }
}

describe('LlmClient — happy path', () => {
  it('calls primary model and returns text + model.actual', async () => {
    mockCreate.mockResolvedValue(buildOkResponse('hello', MODEL_PRIMARY));

    const client = createLlmClient({ client: fakeAnthropic as never });
    const result = await client.generate({
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.text).toBe('hello');
    expect(result.modelRequested).toBe(MODEL_PRIMARY);
    expect(result.modelActual).toBe(MODEL_PRIMARY);
    expect(result.degraded).toBe(false);
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(50);

    expect(mockCreate).toHaveBeenCalledOnce();
    const call = mockCreate.mock.calls[0][0];
    expect(call.model).toBe(MODEL_PRIMARY);
    expect(call.system).toBe('You are helpful');
  });
});

describe('LlmClient — graceful degradation Sonnet → Haiku', () => {
  it('falls back to Haiku when primary returns 500', async () => {
    mockCreate
      .mockRejectedValueOnce(new FakeAPIError(500, 'Internal Server Error'))
      .mockResolvedValueOnce(buildOkResponse('haiku says hello', MODEL_FALLBACK));

    const client = createLlmClient({ client: fakeAnthropic as never });
    const result = await client.generate({
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.text).toBe('haiku says hello');
    expect(result.modelRequested).toBe(MODEL_PRIMARY);
    expect(result.modelActual).toBe(MODEL_FALLBACK);
    expect(result.degraded).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('falls back when primary returns 529 overloaded', async () => {
    mockCreate
      .mockRejectedValueOnce(new FakeAPIError(529, 'Overloaded'))
      .mockResolvedValueOnce(buildOkResponse('ok', MODEL_FALLBACK));

    const client = createLlmClient({ client: fakeAnthropic as never });
    const result = await client.generate({
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.modelActual).toBe(MODEL_FALLBACK);
    expect(result.degraded).toBe(true);
  });

  it('does NOT fall back on 400 bad request — caller bug', async () => {
    mockCreate.mockRejectedValueOnce(new FakeAPIError(400, 'invalid_request'));

    const client = createLlmClient({ client: fakeAnthropic as never });
    await expect(
      client.generate({
        system: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toBeInstanceOf(DomainError);

    expect(mockCreate).toHaveBeenCalledOnce(); // no retry
  });

  it('does NOT fall back on 401 auth error', async () => {
    mockCreate.mockRejectedValueOnce(new FakeAPIError(401, 'auth_required'));

    const client = createLlmClient({ client: fakeAnthropic as never });
    await expect(
      client.generate({
        system: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('throws OperationalError when both models fail with 5xx', async () => {
    mockCreate
      .mockRejectedValueOnce(new FakeAPIError(500, 'down'))
      .mockRejectedValueOnce(new FakeAPIError(500, 'down'));

    const client = createLlmClient({ client: fakeAnthropic as never });
    await expect(
      client.generate({
        system: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toBeInstanceOf(OperationalError);
  });
});

describe('LlmClient — explicit model override', () => {
  it('respects an explicit Haiku override and does not fall back further', async () => {
    // Override = Haiku already (the fallback tier). If Haiku fails, there is no
    // further tier to degrade to — propagate the error.
    mockCreate.mockRejectedValueOnce(new FakeAPIError(500, 'down'));

    const client = createLlmClient({ client: fakeAnthropic as never });
    await expect(
      client.generate({
        model: MODEL_FALLBACK,
        system: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toBeInstanceOf(OperationalError);

    expect(mockCreate).toHaveBeenCalledOnce(); // no retry
  });

  it('uses the override model on the happy path', async () => {
    mockCreate.mockResolvedValueOnce(buildOkResponse('haiku result', MODEL_FALLBACK));

    const client = createLlmClient({ client: fakeAnthropic as never });
    const result = await client.generate({
      model: MODEL_FALLBACK,
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.modelRequested).toBe(MODEL_FALLBACK);
    expect(result.modelActual).toBe(MODEL_FALLBACK);
    expect(result.degraded).toBe(false);
  });
});
