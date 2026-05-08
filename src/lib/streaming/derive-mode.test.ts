import { describe, it, expect } from 'vitest';
import { deriveMode } from '@/lib/streaming/derive-mode';

const baseRow = (
  partial: Partial<{ createdByAgent: string; contribution: object }>,
) => ({
  createdByAgent: 'intake',
  contribution: {},
  ...partial,
});

describe('deriveMode', () => {
  it("returns 'live' when only the intake row is present", () => {
    const states = [baseRow({ createdByAgent: 'intake' })];
    expect(deriveMode(states)).toBe('live');
  });

  it("returns 'live' when no states are present at all (defensive)", () => {
    expect(deriveMode([])).toBe('live');
  });

  it("returns 'persisted' when a decision row exists (happy path complete)", () => {
    const states = [
      baseRow({ createdByAgent: 'intake' }),
      baseRow({ createdByAgent: 'identity' }),
      baseRow({ createdByAgent: 'decision' }),
    ];
    expect(deriveMode(states)).toBe('persisted');
  });

  it("returns 'persisted' when a saga row is present", () => {
    const states = [
      baseRow({ createdByAgent: 'intake' }),
      baseRow({
        createdByAgent: 'orchestrator',
        contribution: { __saga: { type: 'saga' } },
      }),
    ];
    expect(deriveMode(states)).toBe('persisted');
  });

  it("returns 'persisted' when a pipeline_failure row is present", () => {
    const states = [
      baseRow({ createdByAgent: 'intake' }),
      baseRow({
        createdByAgent: 'orchestrator',
        contribution: { __pipeline_failure: { type: 'pipeline_failure' } },
      }),
    ];
    expect(deriveMode(states)).toBe('persisted');
  });

  it("ignores agent rows that are not decision (intermediate state should still be 'live' if user reopens early)", () => {
    const states = [
      baseRow({ createdByAgent: 'intake' }),
      baseRow({ createdByAgent: 'identity' }),
      baseRow({ createdByAgent: 'income' }),
    ];
    // No terminal marker → user is still in flight or a previous run was interrupted.
    // The route handler distinguishes "first run" vs "interrupted" separately;
    // deriveMode only decides which view to render.
    expect(deriveMode(states)).toBe('live');
  });

  it("does NOT confuse a future orchestrator-owned non-saga row (ignored unless type is saga or pipeline_failure)", () => {
    const states = [
      baseRow({ createdByAgent: 'intake' }),
      baseRow({
        createdByAgent: 'orchestrator',
        contribution: {
          __token_budget_exceeded: { type: 'token_budget_exceeded' },
        },
      }),
    ];
    expect(deriveMode(states)).toBe('live');
  });
});
