import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getRegistroCivilClient,
  setMode,
  getBreakerSnapshot,
  __resetForTesting,
} from './index';
import { personas, cedulasNotFound } from '@/services/mocks/_dataset/personas';
import { OperationalError, DomainError } from '@/lib/errors';

beforeEach(() => {
  __resetForTesting();
});

describe('RegistroCivilMock — happy mode', () => {
  it('returns person data for a cedula present in the dataset', async () => {
    const target = personas[0];
    const client = getRegistroCivilClient();

    const person = await client.getPerson(target.cedula);

    expect(person.name).toBe(target.name);
    expect(person.birthDate).toBe(target.birthDate);
    expect(person.deathDate).toBeUndefined();
  });

  it('returns deathDate for fallecidos', async () => {
    const fallecido = personas.find((p) => p.deathDate !== undefined)!;
    const client = getRegistroCivilClient();

    const person = await client.getPerson(fallecido.cedula);

    expect(person.deathDate).toBe(fallecido.deathDate);
  });

  it('throws DomainError("not_found") for a cedula not in the dataset', async () => {
    const client = getRegistroCivilClient();

    await expect(client.getPerson(cedulasNotFound[0])).rejects.toMatchObject({
      name: 'DomainError',
      message: 'not_found',
    });
  });
});

describe('RegistroCivilMock — error_500 mode', () => {
  it('throws OperationalError on every call', async () => {
    setMode('error_500');
    const client = getRegistroCivilClient();

    await expect(
      client.getPerson(personas[0].cedula),
    ).rejects.toBeInstanceOf(OperationalError);
  });

  it('opens the breaker after 5 consecutive error_500 responses', async () => {
    setMode('error_500');
    const client = getRegistroCivilClient();
    const cedula = personas[0].cedula;

    // 5 calls — each fails with OperationalError, breaker counts each
    for (let i = 0; i < 5; i++) {
      await expect(client.getPerson(cedula)).rejects.toBeInstanceOf(
        OperationalError,
      );
    }

    expect(getBreakerSnapshot().state).toBe('OPEN');

    // 6th call: fail-fast, message is "breaker_open"
    await expect(client.getPerson(cedula)).rejects.toMatchObject({
      name: 'OperationalError',
      message: 'breaker_open',
    });
  });
});

describe('RegistroCivilMock — not_found mode', () => {
  it('throws DomainError for any cedula, including ones in the dataset', async () => {
    setMode('not_found');
    const client = getRegistroCivilClient();

    await expect(
      client.getPerson(personas[0].cedula),
    ).rejects.toMatchObject({ name: 'DomainError', message: 'not_found' });
  });

  it('does NOT open the breaker even after many calls', async () => {
    setMode('not_found');
    const client = getRegistroCivilClient();

    for (let i = 0; i < 10; i++) {
      await expect(
        client.getPerson(personas[0].cedula),
      ).rejects.toBeInstanceOf(DomainError);
    }

    expect(getBreakerSnapshot().state).toBe('CLOSED');
    expect(getBreakerSnapshot().failureCount).toBe(0);
  });
});

describe('RegistroCivilMock — slow mode latency stays under timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves successfully after 3s slow latency (under 10s breaker timeout)', async () => {
    setMode('slow');
    const client = getRegistroCivilClient();

    const promise = client.getPerson(personas[0].cedula);
    vi.advanceTimersByTime(3_500);
    await expect(promise).resolves.toMatchObject({ name: personas[0].name });
  });
});
