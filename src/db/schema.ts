import {
  pgTable,
  uuid,
  integer,
  text,
  timestamp,
  jsonb,
  unique,
  vector,
  index,
} from 'drizzle-orm/pg-core';

/**
 * `applications` is the immutable identity of a credit request.
 * Write-once: a row is created when a Solicitud arrives, and never updated.
 * The `applications_immutable` trigger (see migration 0001) enforces this.
 */
export const applications = pgTable('applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * `application_states` is the append-only log of state contributions produced
 * by each agent in the orchestration graph. Each row stores ONLY the slice
 * contributed by that agent — never the full reconstructed state. The full
 * state is rebuilt by `getLatestFullState()` via reduce/spread over versions.
 * The `application_states_immutable` trigger (see migration 0000) blocks
 * UPDATE and DELETE statements against this table.
 */
export const applicationStates = pgTable(
  'application_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id),
    version: integer('version').notNull(),
    createdByAgent: text('created_by_agent').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    contribution: jsonb('contribution').notNull(),
  },
  (table) => [
    unique('application_states_app_version_unique').on(
      table.applicationId,
      table.version,
    ),
  ],
);

/**
 * `rag_chunks` is the RAG corpus persisted with pgvector. Each row is one
 * rule from `docs/policy/cooperativa-policy.md` — chunked at the rule
 * boundary (no sliding window). The `embedding` column is the OpenAI
 * text-embedding-3-small (1536 dims) of `title + condicion + accion +
 * tags-flatten` — see ADR-0007 section 4a.
 *
 * The table is **truncated and re-ingested** by the `pnpm rag:ingest`
 * script — corpus is rebuilt from source-of-truth, not merged. Therefore
 * no immutability trigger is attached (unlike applications / states).
 */
export const ragChunks = pgTable(
  'rag_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ruleId: text('rule_id').notNull(),
    category: text('category').notNull(),
    title: text('title').notNull(),
    fullText: text('full_text').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    metadata: jsonb('metadata').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('rag_chunks_rule_id_unique').on(table.ruleId),
    index('rag_chunks_embedding_hnsw_idx').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops'),
    ),
  ],
);

/**
 * `application_token_usage` is the per-agent record of LLM tokens consumed
 * for a given application. One row per agent that called the LLM (today:
 * policyAgent + decisionAgent). Append-only by convention; no immutability
 * trigger because we may re-run an application during dev (tests TRUNCATE).
 *
 * Slice 7: counting + persistence only. NO enforcement against threshold.
 * Slice 9 reads this table to calibrate the operational threshold for
 * `TOKEN_BUDGET_PER_APPLICATION` (CONTEXT.md term, currently unimplemented).
 * See ADR-0008 section 9.
 */
export const applicationTokenUsage = pgTable(
  'application_token_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id),
    agentName: text('agent_name').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type Application = typeof applications.$inferSelect;
export type ApplicationState = typeof applicationStates.$inferSelect;
export type RagChunk = typeof ragChunks.$inferSelect;
export type ApplicationTokenUsage = typeof applicationTokenUsage.$inferSelect;
