import { describe, it, expect } from 'vitest';
import { RecordingTracer } from '@/lib/tracer';

describe('Tracer / Span propagation', () => {
  it('records the span name and initial attributes', async () => {
    const tracer = new RecordingTracer();

    await tracer.span('intake.execute', { applicationId: 'app-1', version: 0 }, async () => {
      return 'ok';
    });

    expect(tracer.spans).toHaveLength(1);
    expect(tracer.spans[0].name).toBe('intake.execute');
    expect(tracer.spans[0].attributes).toMatchObject({
      applicationId: 'app-1',
      version: 0,
    });
    expect(tracer.spans[0].status).toBe('ok');
  });

  it('propagates setAttribute calls into the recorded span', async () => {
    const tracer = new RecordingTracer();

    await tracer.span('agent.run', {}, async (span) => {
      span.setAttribute('cedula', '1712345678');
      span.setAttribute('decision', 'APPROVED');
    });

    expect(tracer.spans[0].attributes).toMatchObject({
      cedula: '1712345678',
      decision: 'APPROVED',
    });
  });

  it('propagates addEvent calls (with and without attrs) in order', async () => {
    const tracer = new RecordingTracer();

    await tracer.span('agent.run', {}, async (span) => {
      span.addEvent('intake.start');
      span.addEvent('schema.validated', { fields: 4 });
      span.addEvent('intake.complete', { version: 0 });
    });

    expect(tracer.spans[0].events).toEqual([
      { name: 'intake.start', attrs: {} },
      { name: 'schema.validated', attrs: { fields: 4 } },
      { name: 'intake.complete', attrs: { version: 0 } },
    ]);
  });

  it('marks the span as error and rethrows when fn throws', async () => {
    const tracer = new RecordingTracer();

    await expect(
      tracer.span('agent.boom', {}, async () => {
        throw new Error('something broke');
      }),
    ).rejects.toThrow('something broke');

    expect(tracer.spans[0].status).toBe('error');
    expect(tracer.spans[0].error).toBe('something broke');
  });

  it('returns the value produced by fn', async () => {
    const tracer = new RecordingTracer();

    const result = await tracer.span('compute', {}, async () => 42);

    expect(result).toBe(42);
  });
});
