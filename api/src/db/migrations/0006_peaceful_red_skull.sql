CREATE TABLE "activity_event_moderation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"administrator_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"reason" text NOT NULL,
	"applied" boolean DEFAULT false NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_hidden_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"event_type" text NOT NULL,
	"actor" text NOT NULL,
	"event_idempotency_key" text NOT NULL,
	"event_created_at" timestamp with time zone NOT NULL,
	"event_json" text NOT NULL,
	"administrator_id" text NOT NULL,
	"reason" text NOT NULL,
	"hidden_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_event_moderation_requests" ADD CONSTRAINT "activity_event_moderation_requests_event_id_activity_hidden_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."activity_hidden_events"("event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_event_moderation_requests_administrator_idempotency_idx" ON "activity_event_moderation_requests" USING btree ("administrator_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "activity_event_moderation_requests_event_requested_at_idx" ON "activity_event_moderation_requests" USING btree ("event_id","requested_at");--> statement-breakpoint
CREATE INDEX "activity_hidden_events_hidden_at_idx" ON "activity_hidden_events" USING btree ("hidden_at","event_id");--> statement-breakpoint
CREATE INDEX "activity_hidden_events_actor_idx" ON "activity_hidden_events" USING btree ("actor");--> statement-breakpoint
CREATE INDEX "activity_hidden_events_source_idx" ON "activity_hidden_events" USING btree ("source");