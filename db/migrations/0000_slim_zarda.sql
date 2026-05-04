CREATE TABLE "application_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"created_by_agent" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "application_states_app_version_unique" UNIQUE("application_id","version")
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_states" ADD CONSTRAINT "application_states_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Immutability invariant: applications and application_states are write-once / append-only.
-- TRUNCATE bypasses these triggers and is allowed (used in tests for cleanup).
CREATE OR REPLACE FUNCTION raise_immutable_exception()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'table % is immutable: % blocked', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER applications_immutable
  BEFORE UPDATE OR DELETE ON applications
  FOR EACH ROW
  EXECUTE FUNCTION raise_immutable_exception();
--> statement-breakpoint
CREATE TRIGGER application_states_immutable
  BEFORE UPDATE OR DELETE ON application_states
  FOR EACH ROW
  EXECUTE FUNCTION raise_immutable_exception();