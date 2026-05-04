import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBreaker } from './index';
import { OperationalError, DomainError } from '@/lib/errors';

const defaultOpts = {
  failureThreshold: 3,
  cooldownMs: 1_000,
  halfOpenMaxCalls: 1,
  timeoutMs: 5_000,
};

describe('createBreaker — CLOSED happy path', () => {
  it('returns the result of fn when CLOSED and fn succeeds', async () => {
    const breaker = createBreaker(defaultOpts);

    const result = await breaker.call(async () => 'ok');

    expect(result).toBe('ok');
    expect(breaker.getState().state).toBe('CLOSED');
    expect(breaker.getState().failureCount).toBe(0);
  });
});

describe('createBreaker — failure counting', () => {
  it('increments failureCount when fn throws OperationalError', async () => {
    const breaker = createBreaker(defaultOpts);

    await expect(
      breaker.call(async () => {
        throw new OperationalError('boom');
      }),
    ).rejects.toBeInstanceOf(OperationalError);

    expect(breaker.getState().failureCount).toBe(1);
    expect(breaker.getState().state).toBe('CLOSED');
  });

  it('does NOT increment failureCount when fn throws DomainError', async () => {
    const breaker = createBreaker(defaultOpts);

    await expect(
      breaker.call(async () => {
        throw new DomainError('not_found');
      }),
    ).rejects.toBeInstanceOf(DomainError);

    expect(breaker.getState().failureCount).toBe(0);
    expect(breaker.getState().state).toBe('CLOSED');
  });
});

describe('createBreaker — CLOSED → OPEN transition', () => {
  it('opens after failureThreshold consecutive OperationalErrors', async () => {
    const breaker = createBreaker({ ...defaultOpts, failureThreshold: 3 });

    for (let i = 0; i < 3; i++) {
      await expect(
        breaker.call(async () => {
          throw new OperationalError(`fail-${i}`);
        }),
      ).rejects.toBeInstanceOf(OperationalError);
    }

    expect(breaker.getState().state).toBe('OPEN');
    expect(breaker.getState().failureCount).toBe(3);
  });

  it('does NOT open from DomainError accumulation', async () => {
    const breaker = createBreaker({ ...defaultOpts, failureThreshold: 3 });

    for (let i = 0; i < 5; i++) {
      await expect(
        breaker.call(async () => {
          throw new DomainError(`miss-${i}`);
        }),
      ).rejects.toBeInstanceOf(DomainError);
    }

    expect(breaker.getState().state).toBe('CLOSED');
    expect(breaker.getState().failureCount).toBe(0);
  });
});

describe('createBreaker — OPEN → HALF_OPEN cooldown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('transitions to HALF_OPEN after cooldownMs and invokes fn on next call', async () => {
    const breaker = createBreaker({
      ...defaultOpts,
      failureThreshold: 1,
      cooldownMs: 1_000,
    });

    // Trip
    await expect(
      breaker.call(async () => {
        throw new OperationalError('trip');
      }),
    ).rejects.toBeInstanceOf(OperationalError);
    expect(breaker.getState().state).toBe('OPEN');

    // Before cooldown elapses: still fail-fast
    vi.advanceTimersByTime(500);
    let invoked = false;
    await expect(
      breaker.call(async () => {
        invoked = true;
        return 'x';
      }),
    ).rejects.toMatchObject({ message: 'breaker_open' });
    expect(invoked).toBe(false);

    // After cooldown: transitions to HALF_OPEN, fn IS invoked
    vi.advanceTimersByTime(600); // total 1100ms > cooldownMs
    const result = await breaker.call(async () => 'recovered');
    expect(result).toBe('recovered');
    expect(breaker.getState().state).toBe('CLOSED');
    expect(breaker.getState().failureCount).toBe(0);
  });

  it('re-opens when fn fails during HALF_OPEN probe', async () => {
    const breaker = createBreaker({
      ...defaultOpts,
      failureThreshold: 1,
      cooldownMs: 1_000,
    });

    await expect(
      breaker.call(async () => {
        throw new OperationalError('trip');
      }),
    ).rejects.toBeInstanceOf(OperationalError);

    vi.advanceTimersByTime(1_500);

    await expect(
      breaker.call(async () => {
        throw new OperationalError('still-down');
      }),
    ).rejects.toBeInstanceOf(OperationalError);

    expect(breaker.getState().state).toBe('OPEN');
  });
});

describe('createBreaker — timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws OperationalError("timeout") when fn exceeds timeoutMs', async () => {
    const breaker = createBreaker({ ...defaultOpts, timeoutMs: 1_000 });

    const slowFn = () =>
      new Promise<string>((resolve) => setTimeout(() => resolve('late'), 5_000));

    const promise = breaker.call(slowFn);
    vi.advanceTimersByTime(1_500);

    await expect(promise).rejects.toMatchObject({
      name: 'OperationalError',
      message: 'timeout',
    });
    expect(breaker.getState().failureCount).toBe(1);
  });
});

describe('createBreaker — OPEN fail-fast', () => {
  it('rejects with OperationalError("breaker_open") without invoking fn', async () => {
    const breaker = createBreaker({ ...defaultOpts, failureThreshold: 2 });

    // Trip the breaker
    await expect(
      breaker.call(async () => {
        throw new OperationalError('first');
      }),
    ).rejects.toBeInstanceOf(OperationalError);
    await expect(
      breaker.call(async () => {
        throw new OperationalError('second');
      }),
    ).rejects.toBeInstanceOf(OperationalError);
    expect(breaker.getState().state).toBe('OPEN');

    // Now call should fail-fast — fn is never invoked
    let fnInvoked = false;
    await expect(
      breaker.call(async () => {
        fnInvoked = true;
        return 'should-never-return';
      }),
    ).rejects.toMatchObject({
      name: 'OperationalError',
      message: 'breaker_open',
    });

    expect(fnInvoked).toBe(false);
    // failureCount stays at the trip count — fail-fast does NOT increment
    expect(breaker.getState().failureCount).toBe(2);
  });
});
