CREATE TABLE "activity_event_endorsements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "activity_event_endorsements_event_user_idx" ON "activity_event_endorsements" USING btree ("event_id","user_id");--> statement-breakpoint
CREATE INDEX "activity_event_endorsements_event_idx" ON "activity_event_endorsements" USING btree ("event_id");