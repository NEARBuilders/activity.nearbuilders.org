CREATE TABLE "activity_binding_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_token_hash" text NOT NULL,
	"poll_token_hash" text NOT NULL,
	"match_code" text NOT NULL,
	"draft_json" text NOT NULL,
	"source_record_id" uuid,
	"completed_by" text,
	"completed_at" timestamp with time zone,
	"key_claimed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"claim_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_binding_sessions" ADD CONSTRAINT "activity_binding_sessions_source_record_id_activity_sources_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."activity_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_binding_sessions_session_token_idx" ON "activity_binding_sessions" USING btree ("session_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_binding_sessions_poll_token_idx" ON "activity_binding_sessions" USING btree ("poll_token_hash");