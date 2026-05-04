import { describe, it, expect, beforeEach } from 'vitest';
import { incomeAgent } from '@/agents/income';
import { __resetForTesting, setMode } from '@/services/mocks/iess';
import { personas } from '@/services/mocks/_dataset/personas';
import { RecordingTracer } from '@/lib/tracer';
import { OperationalError, DomainError } from '@/lib/errors';

beforeEach(() => {
  __resetForTesting();
});

const baseState = {
  ingresos: 1500,
  monto: 3000,
  plazo: 24,
};

describe('incomeAgent — happy path', () => {
  it('selects cedula from FullState and returns employment contribution', async () => {
    const target = personas.find((p) => p.employment !== undefined)!;
    const tracer = new RecordingTracer();

    const input = incomeAgent.selectInput({
      ...baseState,
      cedula: target.cedula,
    });
    expect(input).toEqual({ cedula: target.cedula });

    const output = await incomeAgent.execute(input, { tracer });

    expect(output).toEqual({
      employer: target.employment!.employer,
      salary: target.employment!.salary,
      monthsActive: target.employment!.monthsActive,
    });
  });
});

describe('incomeAgent — error paths', () => {
  it('propagates DomainError when persona is autónomo (no employment)', async () => {
    const autonomo = personas.find(
      (p) => p.employment === undefined && p.deathDate === undefined,
    )!;
    const tracer = new RecordingTracer();

    await expect(
      incomeAgent.execute({ cedula: autonomo.cedula }, { tracer }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('propagates OperationalError when mock is in error_503 mode', async () => {
    setMode('error_503');
    const target = personas.find((p) => p.employment !== undefined)!;
    const tracer = new RecordingTracer();

    await expect(
      incomeAgent.execute({ cedula: target.cedula }, { tracer }),
    ).rejects.toBeInstanceOf(OperationalError);
  });
});

describe('incomeAgent — observability', () => {
  it('emits a span named income.execute with breaker.state attribute', async () => {
    const tracer = new RecordingTracer();
    const target = personas.find((p) => p.employment !== undefined)!;

    await incomeAgent.execute({ cedula: target.cedula }, { tracer });

    expect(tracer.spans).toHaveLength(1);
    const span = tracer.spans[0];
    expect(span.name).toBe('income.execute');
    expect(span.attributes['breaker.state']).toBe('CLOSED');
    expect(span.attributes.agent).toBe('income');
    expect(span.status).toBe('ok');
  });
});

describe('incomeAgent — schema contracts', () => {
  it('inputSchema rejects malformed cedula at the boundary', () => {
    expect(
      incomeAgent.inputSchema.safeParse({ cedula: 'BAD' }).success,
    ).toBe(false);
  });

  it('outputSchema accepts well-formed employment shape', () => {
    expect(
      incomeAgent.outputSchema.safeParse({
        employer: 'Empresa SA',
        salary: 1500,
        monthsActive: 36,
      }).success,
    ).toBe(true);
  });

  it('outputSchema rejects negative salary or monthsActive', () => {
    expect(
      incomeAgent.outputSchema.safeParse({
        employer: 'X',
        salary: -1,
        monthsActive: 12,
      }).success,
    ).toBe(false);
  });
});
