import { z } from 'zod';
import type { Agent } from '@/agents/_base/types';
import { OperationalError } from '@/lib/errors';

/**
 * Test fixture: an agent that always throws OperationalError.
 * Used in orchestrator integration tests to trigger saga walk-back
 * after `bureau` has run, so the compensate() chain can be exercised
 * without waiting for a real downstream agent (decision, slice 7).
 */
export const failingTestAgent: Agent<{ trigger: true }, never> = {
  name: 'failing_test_agent',
  inputSchema: z.object({ trigger: z.literal(true) }),
  outputSchema: z.never(),
  selectInput: () => ({ trigger: true as const }),
  async execute(): Promise<never> {
    throw new OperationalError('failing_test_agent_threw');
  },
};
