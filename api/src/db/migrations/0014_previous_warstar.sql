ALTER TABLE "activity_binding_sessions" ADD COLUMN "delivery" text DEFAULT 'agent' NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_binding_sessions" ADD COLUMN "issuer_source_id" text;--> statement-breakpoint
ALTER TABLE "activity_sources" ADD COLUMN "last_test_event_at" timestamp with time zone;