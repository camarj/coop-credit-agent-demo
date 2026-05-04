import { describe, it, expect, beforeEach } from 'vitest';
import { identityAgent } from '@/agents/identity';
import { __resetForTesting, setMode } from '@/services/mocks/registro-civil';
import { personas, cedulasNotFound } from '@/services/mocks/_dataset/personas';
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

describe('identityAgent — happy path', () => {
  it('selects cedula from FullState and returns identity contribution', async () => {
    const target = personas[0];
    const tracer = new RecordingTracer();

    const input = identityAgent.selectInput({
      ...baseState,
      cedula: target.cedula,
    });
    expect(input).toEqual({ cedula: target.cedula });

    const output = await identityAgent.execute(input, { tracer });

    expect(output).toEqual({
      name: target.name,
      birthDate: target.birthDate,
      valid: true,
    });
  });

  it('marks fallecidos as valid: false', async () => {
    const fallecido = personas.find((p) => p.deathDate !== undefined)!;
    const tracer = new RecordingTracer();

    const output = await identityAgent.execute(
      { cedula: fallecido.cedula },
      { tracer },
    );

    expect(output).toEqual({
      name: fallecido.name,
      birthDate: fallecido.birthDate,
      valid: false,
    });
  });
});

describe('identityAgent — error paths', () => {
  it('propagates DomainError when cedula not in dataset', async () => {
    const tracer = new RecordingTracer();

    await expect(
      identityAgent.execute({ cedula: cedulasNotFound[0] }, { tracer }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('propagates OperationalError when mock is in error_500 mode', async () => {
    setMode('error_500');
    const tracer = new RecordingTracer();

    await expect(
      identityAgent.execute({ cedula: personas[0].cedula }, { tracer }),
    ).rejects.toBeInstanceOf(OperationalError);
  });
});

describe('identityAgent — observability', () => {
  it('emits a span named identity.execute with breaker.state attribute', async () => {
    const tracer = new RecordingTracer();

    await identityAgent.execute(
      { cedula: personas[0].cedula },
      { tracer },
    );

    expect(tracer.spans).toHaveLength(1);
    const span = tracer.spans[0];
    expect(span.name).toBe('identity.execute');
    expect(span.attributes['breaker.state']).toBe('CLOSED');
    expect(span.attributes.agent).toBe('identity');
    expect(span.status).toBe('ok');
  });

  it('marks span as error when DomainError is thrown', async () => {
    const tracer = new RecordingTracer();

    await expect(
      identityAgent.execute({ cedula: cedulasNotFound[0] }, { tracer }),
    ).rejects.toBeInstanceOf(DomainError);

    expect(tracer.spans[0].status).toBe('error');
  });
});

describe('identityAgent — schema contracts', () => {
  it('inputSchema rejects malformed cedula at the boundary', () => {
    const result = identityAgent.inputSchema.safeParse({ cedula: 'BAD' });
    expect(result.success).toBe(false);
  });

  it('outputSchema describes the contribution shape', () => {
    const valid = identityAgent.outputSchema.safeParse({
      name: 'X',
      birthDate: '1990-01-01',
      valid: true,
    });
    expect(valid.success).toBe(true);
  });
});
