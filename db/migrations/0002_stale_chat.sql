-- pgvector extension: idempotent so re-runs are safe.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "rag_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"full_text" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rag_chunks_rule_id_unique" UNIQUE("rule_id")
);
--> statement-breakpoint
CREATE INDEX "rag_chunks_embedding_hnsw_idx" ON "rag_chunks" USING hnsw ("embedding" vector_cosine_ops);