import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getEquifaxClient,
  setMode,
  getBreakerSnapshot,
  __resetForTesting,
} from './index';
import { HARD_INQUIRY_PENALTY, SCORE_FLOOR } from './config';
import { personas } from '@/services/mocks/_dataset/personas';
import { OperationalError, DomainError } from '@/lib/errors';

beforeEach(() => {
  __resetForTesting();
});

describe('EquifaxMock — happy mode (side-effect baseline)', () => {
  it('first hard pull returns baseScore minus one penalty', async () => {
    const target = personas[0]; // baseScore 720
    const client = getEquifaxClient();

    const report = await client.requestHardPull(target.cedula);

    expect(report.score).toBe(target.equifaxBaseScore - HARD_INQUIRY_PENALTY);
    expect(report.hardInquiriesCount).toBe(1);
    expect(report.history).toHaveLength(1);
  });

  it('subsequent pulls keep dropping the score by penalty per inquiry', async () => {
    const target = personas[0];
    const client = getEquifaxClient();

    await client.requestHardPull(target.cedula);
    await client.requestHardPull(target.cedula);
    const r3 = await client.requestHardPull(target.cedula);

    expect(r3.hardInquiriesCount).toBe(3);
    expect(r3.score).toBe(target.equifaxBaseScore - 3 * HARD_INQUIRY_PENALTY);
  });

  it('floors the score at SCORE_FLOOR no matter how many inquiries', async () => {
    const target = personas.find((p) => p.equifaxBaseScore < 500)!; // very low band
    const client = getEquifaxClient();

    for (let i = 0; i < 50; i++) {
      await client.requestHardPull(target.cedula);
    }
    const last = await client.requestHardPull(target.cedula);

    expect(last.score).toBe(SCORE_FLOOR);
  });
});

describe('EquifaxMock — removeLastHardInquiry (compensate primitive)', () => {
  it('removes the last inquiry and restores the previous score', async () => {
    const target = personas[0];
    const client = getEquifaxClient();

    await client.requestHardPull(target.cedula); // count=1, score=base-30
    await client.requestHardPull(target.cedula); // count=2, score=base-60

    await client.removeLastHardInquiry(target.cedula); // back to count=1

    const after = await client.requestHardPull(target.cedula); // count=2 again
    expect(after.hardInquiriesCount).toBe(2);
  });

  it('does nothing if no inquiries exist (idempotent on empty)', async () => {
    const target = personas[0];
    const client = getEquifaxClient();

    await expect(
      client.removeLastHardInquiry(target.cedula),
    ).resolves.toBeUndefined();

    const after = await client.requestHardPull(target.cedula);
    expect(after.hardInquiriesCount).toBe(1);
  });
});

describe('EquifaxMock — error_429 mode', () => {
  it('throws OperationalError on every call', async () => {
    setMode('error_429');
    const client = getEquifaxClient();

    await expect(
      client.requestHardPull(personas[0].cedula),
    ).rejects.toBeInstanceOf(OperationalError);
  });

  it('opens the breaker after 5 consecutive errors', async () => {
    setMode('error_429');
    const client = getEquifaxClient();

    for (let i = 0; i < 5; i++) {
      await expect(
        client.requestHardPull(personas[0].cedula),
      ).rejects.toBeInstanceOf(OperationalError);
    }

    expect(getBreakerSnapshot().state).toBe('OPEN');
  });

  it('does NOT add a hard inquiry when call fails', async () => {
    setMode('error_429');
    const client = getEquifaxClient();
    const target = personas[0];

    await expect(
      client.requestHardPull(target.cedula),
    ).rejects.toBeInstanceOf(OperationalError);

    // Switch to happy and verify no inquiries were recorded
    setMode('happy');
    const ok = await client.requestHardPull(target.cedula);
    expect(ok.hardInquiriesCount).toBe(1);
  });
});

describe('EquifaxMock — score_bajo / score_alto forced modes', () => {
  it('score_bajo overrides to a low score regardless of dataset value', async () => {
    setMode('score_bajo');
    const target = personas.find((p) => p.equifaxBaseScore >= 750)!;
    const client = getEquifaxClient();

    const report = await client.requestHardPull(target.cedula);
    expect(report.score).toBeLessThan(500);
  });

  it('score_alto overrides to a high score', async () => {
    setMode('score_alto');
    const target = personas.find((p) => p.equifaxBaseScore < 500)!;
    const client = getEquifaxClient();

    const report = await client.requestHardPull(target.cedula);
    expect(report.score).toBeGreaterThanOrEqual(750);
  });
});

describe('EquifaxMock — slow mode under timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after 5s slow latency (under 10s breaker timeout)', async () => {
    setMode('slow');
    const target = personas[0];
    const client = getEquifaxClient();

    const promise = client.requestHardPull(target.cedula);
    vi.advanceTimersByTime(5_500);

    await expect(promise).resolves.toMatchObject({
      hardInquiriesCount: 1,
    });
  });
});
