import { OperationalError } from '@/lib/errors';

export interface BreakerOptions {
  failureThreshold: number;
  cooldownMs: number;
  halfOpenMaxCalls: number;
  timeoutMs: number;
}

export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface BreakerSnapshot {
  state: BreakerState;
  failureCount: number;
  lastTransition: number;
}

export interface Breaker {
  call<T>(fn: () => Promise<T>): Promise<T>;
  getState(): BreakerSnapshot;
  reset(): void;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new OperationalError('timeout'));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function createBreaker(opts: BreakerOptions): Breaker {
  const snapshot: BreakerSnapshot = {
    state: 'CLOSED',
    failureCount: 0,
    lastTransition: 0,
  };

  return {
    async call<T>(fn: () => Promise<T>): Promise<T> {
      if (snapshot.state === 'OPEN') {
        const cooldownElapsed =
          Date.now() - snapshot.lastTransition >= opts.cooldownMs;
        if (cooldownElapsed) {
          snapshot.state = 'HALF_OPEN';
          snapshot.lastTransition = Date.now();
        } else {
          throw new OperationalError('breaker_open');
        }
      }

      try {
        const result = await withTimeout(fn(), opts.timeoutMs);
        if (snapshot.state === 'HALF_OPEN') {
          snapshot.state = 'CLOSED';
          snapshot.failureCount = 0;
          snapshot.lastTransition = Date.now();
        }
        return result;
      } catch (err) {
        if (err instanceof OperationalError) {
          if (snapshot.state === 'HALF_OPEN') {
            snapshot.state = 'OPEN';
            snapshot.lastTransition = Date.now();
            throw err;
          }
          snapshot.failureCount++;
          if (snapshot.failureCount >= opts.failureThreshold) {
            snapshot.state = 'OPEN';
            snapshot.lastTransition = Date.now();
          }
        }
        throw err;
      }
    },
    getState(): BreakerSnapshot {
      return { ...snapshot };
    },
    reset(): void {
      snapshot.state = 'CLOSED';
      snapshot.failureCount = 0;
      snapshot.lastTransition = 0;
    },
  };
}
