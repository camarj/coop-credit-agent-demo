import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getIessClient,
  setMode,
  getBreakerSnapshot,
  __resetForTesting,
} from './index';
import { personas } from '@/services/mocks/_dataset/personas';
import { OperationalError, DomainError } from '@/lib/errors';

beforeEach(() => {
  __resetForTesting();
});

describe('IessMock — happy mode', () => {
  it('returns employment record for an afiliado', async () => {
    const afiliado = personas.find((p) => p.employment !== undefined)!;
    const client = getIessClient();

    const employment = await client.getEmployment(afiliado.cedula);

    expect(employment.employer).toBe(afiliado.employment!.employer);
    expect(employment.salary).toBe(afiliado.employment!.salary);
    expect(employment.monthsActive).toBe(afiliado.employment!.monthsActive);
  });

  it('throws DomainError("sin_afiliacion") for an autónomo', async () => {
    const autonomo = personas.find(
      (p) => p.employment === undefined && p.deathDate === undefined,
    )!;
    const client = getIessClient();

    await expect(client.getEmployment(autonomo.cedula)).rejects.toMatchObject({
      name: 'DomainError',
      message: 'sin_afiliacion',
    });
  });

  it('throws DomainError("sin_afiliacion") for a fallecido (no active employment)', async () => {
    const fallecido = personas.find((p) => p.deathDate !== undefined)!;
    const client = getIessClient();

    await expect(
      client.getEmployment(fallecido.cedula),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe('IessMock — error_503 mode', () => {
  it('throws OperationalError on every call', async () => {
    setMode('error_503');
    const afiliado = personas.find((p) => p.employment !== undefined)!;
    const client = getIessClient();

    await expect(
      client.getEmployment(afiliado.cedula),
    ).rejects.toBeInstanceOf(OperationalError);
  });

  it('opens the breaker after 7 consecutive errors (per-mock threshold)', async () => {
    setMode('error_503');
    const afiliado = personas.find((p) => p.employment !== undefined)!;
    const client = getIessClient();

    for (let i = 0; i < 7; i++) {
      await expect(
        client.getEmployment(afiliado.cedula),
      ).rejects.toBeInstanceOf(OperationalError);
    }

    expect(getBreakerSnapshot().state).toBe('OPEN');
    await expect(
      client.getEmployment(afiliado.cedula),
    ).rejects.toMatchObject({ message: 'breaker_open' });
  });
});

describe('IessMock — sin_afiliacion mode (forced)', () => {
  it('throws DomainError for any cedula, including afiliados', async () => {
    setMode('sin_afiliacion');
    const afiliado = personas.find((p) => p.employment !== undefined)!;
    const client = getIessClient();

    await expect(
      client.getEmployment(afiliado.cedula),
    ).rejects.toMatchObject({ name: 'DomainError', message: 'sin_afiliacion' });
  });

  it('does NOT open the breaker even after many calls', async () => {
    setMode('sin_afiliacion');
    const afiliado = personas.find((p) => p.employment !== undefined)!;
    const client = getIessClient();

    for (let i = 0; i < 10; i++) {
      await expect(
        client.getEmployment(afiliado.cedula),
      ).rejects.toBeInstanceOf(DomainError);
    }

    expect(getBreakerSnapshot().state).toBe('CLOSED');
    expect(getBreakerSnapshot().failureCount).toBe(0);
  });
});

describe('IessMock — slow mode under timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after 8s slow latency (under 15s breaker timeout)', async () => {
    setMode('slow');
    const afiliado = personas.find((p) => p.employment !== undefined)!;
    const client = getIessClient();

    const promise = client.getEmployment(afiliado.cedula);
    vi.advanceTimersByTime(8_500);

    await expect(promise).resolves.toMatchObject({
      employer: afiliado.employment!.employer,
    });
  });
});
