import {
  pgTable,
  uuid,
  integer,
  text,
  timestamp,
  jsonb,
  unique,
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
 * `application_states` is the append-only log of state snapshots produced
 * by each agent in the orchestration graph.
 * The `application_states_immutable` trigger (see migration 0001) blocks
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
    data: jsonb('data').notNull(),
  },
  (table) => [
    unique('application_states_app_version_unique').on(
      table.applicationId,
      table.version,
    ),
  ],
);

export type Application = typeof applications.$inferSelect;
export type ApplicationState = typeof applicationStates.$inferSelect;
