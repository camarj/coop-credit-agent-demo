import { eq, asc } from 'drizzle-orm';
import { db } from './client';
import { applicationStates } from './schema';
import type { FullState } from '@/agents/_base/types';

/**
 * Reads every state row for the application in version order and reduces
 * them via spread into the FullState. v0 (intake) writes flat; every
 * other agent's contribution is namespaced under its agent name.
 * See ADR-0004.
 */
export async function getLatestFullState(
  applicationId: string,
): Promise<FullState> {
  const rows = await db
    .select()
    .from(applicationStates)
    .where(eq(applicationStates.applicationId, applicationId))
    .orderBy(asc(applicationStates.version));

  return rows.reduce<FullState>(
    (acc, row) => ({ ...acc, ...(row.contribution as object) }),
    {} as FullState,
  );
}

interface PersistArgs {
  version: number;
  agentName: string;
  contribution: object;
}

/**
 * Appends a new state row with the contribution namespaced under
 * `agentName`. Used for every agent in the graph (NOT intake, which
 * writes flat in its own transaction). See ADR-0004.
 */
export async function persistContribution(
  applicationId: string,
  args: PersistArgs,
): Promise<void> {
  await db.insert(applicationStates).values({
    applicationId,
    version: args.version,
    createdByAgent: args.agentName,
    contribution: { [args.agentName]: args.contribution },
  });
}
