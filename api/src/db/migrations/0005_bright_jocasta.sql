CREATE TABLE "activity_event_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_record_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"event_id" text,
	"event_json" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_event_submissions" ADD CONSTRAINT "activity_event_submissions_source_record_id_activity_sources_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."activity_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_event_submissions_source_idempotency_idx" ON "activity_event_submissions" USING btree ("source_record_id","idempotency_key");