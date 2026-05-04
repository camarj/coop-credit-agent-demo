/**
 * Operational failure of an external dependency: timeout, 5xx, network.
 * Counts toward the circuit breaker failure threshold. See ADR-0003.
 */
export class OperationalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperationalError';
  }
}

/**
 * Semantic failure from the domain (resource not found, score below
 * threshold, etc). Does NOT count toward the circuit breaker — the
 * dependency answered correctly, the answer was just "no". See ADR-0003.
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}
