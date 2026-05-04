import { describe, it, expect, beforeEach } from 'vitest';
import { bureauAgent } from '@/agents/bureau';
import {
  __resetForTesting,
  setMode,
  getEquifaxClient,
} from '@/services/mocks/equifax';
import { HARD_INQUIRY_PENALTY } from '@/services/mocks/equifax/config';
import { personas } from '@/services/mocks/_dataset/personas';
import { RecordingTracer } from '@/lib/tracer';
import { OperationalError } from '@/lib/errors';

beforeEach(() => {
  __resetForTesting();
});

const baseState = {
  ingresos: 1500,
  monto: 3000,
  plazo: 24,
};

describe('bureauAgent — happy path', () => {
  it('selects cedula and returns score = baseScore − penalty after first pull', async () => {
    const target = personas[0]; // baseScore 720
    const tracer = new RecordingTracer();

    const input = bureauAgent.selectInput({
      ...baseState,
      cedula: target.cedula,
    });
    expect(input).toEqual({ cedula: target.cedula });

    const output = await bureauAgent.execute(input, { tracer });

    expect(output.score).toBe(target.equifaxBaseScore - HARD_INQUIRY_PENALTY);
    expect(output.hardInquiriesCount).toBe(1);
    expect(output.history).toHaveLength(1);
  });
});

describe('bureauAgent — compensate restores score', () => {
  it('removes the last hard inquiry, returning the persona to the previous state', async () => {
    const target = personas[0];
    const tracer = new RecordingTracer();

    // Run execute → 1 inquiry recorded, score = base − 30
    const first = await bureauAgent.execute({ cedula: target.cedula }, { tracer });
    expect(first.hardInquiriesCount).toBe(1);

    // Compensate → inquiry removed
    await bureauAgent.compensate!({ cedula: target.cedula }, { tracer });

    // Next pull should behave as if it were the first again
    const client = getEquifaxClient();
    const after = await client.requestHardPull(target.cedula);
    expect(after.hardInquiriesCount).toBe(1);
    expect(after.score).toBe(target.equifaxBaseScore - HARD_INQUIRY_PENALTY);
  });

  it('compensate is idempotent — calling twice does not under-flow', async () => {
    const target = personas[0];
    const tracer = new RecordingTracer();

    await bureauAgent.execute({ cedula: target.cedula }, { tracer });
    await bureauAgent.compensate!({ cedula: target.cedula }, { tracer });
    await expect(
      bureauAgent.compensate!({ cedula: target.cedula }, { tracer }),
    ).resolves.toBeUndefined();
  });
});

describe('bureauAgent — error paths', () => {
  it('propagates OperationalError when mock is in error_429 mode', async () => {
    setMode('error_429');
    const tracer = new RecordingTracer();

    await expect(
      bureauAgent.execute({ cedula: personas[0].cedula }, { tracer }),
    ).rejects.toBeInstanceOf(OperationalError);
  });
});

describe('bureauAgent — observability', () => {
  it('emits span bureau.execute with breaker.state attribute', async () => {
    const tracer = new RecordingTracer();
    await bureauAgent.execute(
      { cedula: personas[0].cedula },
      { tracer },
    );

    const span = tracer.spans.find((s) => s.name === 'bureau.execute')!;
    expect(span.attributes['breaker.state']).toBe('CLOSED');
    expect(span.attributes.agent).toBe('bureau');
  });

  it('emits span bureau.compensate during compensation', async () => {
    const tracer = new RecordingTracer();
    await bureauAgent.execute(
      { cedula: personas[0].cedula },
      { tracer },
    );
    await bureauAgent.compensate!(
      { cedula: personas[0].cedula },
      { tracer },
    );

    const compensateSpan = tracer.spans.find(
      (s) => s.name === 'bureau.compensate',
    )!;
    expect(compensateSpan).toBeDefined();
    expect(compensateSpan.status).toBe('ok');
  });
});

describe('bureauAgent — schema contracts', () => {
  it('outputSchema accepts well-formed bureau report', () => {
    expect(
      bureauAgent.outputSchema.safeParse({
        score: 700,
        history: [{ at: 1, source: 'cooperativa-demo' }],
        hardInquiriesCount: 1,
      }).success,
    ).toBe(true);
  });

  it('outputSchema rejects negative score', () => {
    expect(
      bureauAgent.outputSchema.safeParse({
        score: -1,
        history: [],
        hardInquiriesCount: 0,
      }).success,
    ).toBe(false);
  });
});
