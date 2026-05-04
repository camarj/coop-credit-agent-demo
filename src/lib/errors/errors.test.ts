import { describe, it, expect } from 'vitest';
import { OperationalError, DomainError } from './index';

describe('OperationalError vs DomainError — discrimination', () => {
  it('OperationalError is instanceof Error and OperationalError but NOT DomainError', () => {
    const err = new OperationalError('timeout');

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(OperationalError);
    expect(err).not.toBeInstanceOf(DomainError);
    expect(err.message).toBe('timeout');
    expect(err.name).toBe('OperationalError');
  });

  it('DomainError is instanceof Error and DomainError but NOT OperationalError', () => {
    const err = new DomainError('not_found');

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DomainError);
    expect(err).not.toBeInstanceOf(OperationalError);
    expect(err.message).toBe('not_found');
    expect(err.name).toBe('DomainError');
  });
});
