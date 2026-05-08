/**
 * Decides whether the page should render <LiveView> (open the SSE stream
 * and watch the agents run) or <PersistedView> (read v0..vN from Postgres
 * as a static snapshot). Pure function over the rows of `application_states`.
 *
 * 'persisted' when:
 *   - any row is the decisionAgent contribution (happy path complete), OR
 *   - any orchestrator row carries __saga.type === 'saga' (walk-back done), OR
 *   - any orchestrator row carries __pipeline_failure.type === 'pipeline_failure'
 *
 * 'live' otherwise. Note: rows from intermediate agents (identity, income,
 * etc.) without a terminal marker mean the run was interrupted — the GET
 * stream handler short-circuits that case independently rather than
 * re-running the orchestrator.
 *
 * Discriminating by payload type (instead of `createdByAgent === 'orchestrator'`)
 * future-proofs the decision: slice 9+ may add other orchestrator-owned rows
 * (e.g. token_budget_exceeded) that are NOT terminal.
 */

interface StateRow {
  createdByAgent: string;
  contribution: unknown;
}

export type ApplicationMode = 'live' | 'persisted';

interface OrchestratorContribution {
  __saga?: { type?: string };
  __pipeline_failure?: { type?: string };
}

export function deriveMode(states: StateRow[]): ApplicationMode {
  for (const row of states) {
    if (row.createdByAgent === 'decision') return 'persisted';
    if (row.createdByAgent === 'orchestrator') {
      const c = row.contribution as OrchestratorContribution;
      if (c?.__saga?.type === 'saga') return 'persisted';
      if (c?.__pipeline_failure?.type === 'pipeline_failure') return 'persisted';
    }
  }
  return 'live';
}
