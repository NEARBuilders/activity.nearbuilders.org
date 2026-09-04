CREATE TYPE "public"."activity_source_trust_status" AS ENUM('standard', 'trusted');--> statement-breakpoint
CREATE TABLE "activity_source_trust_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_record_id" uuid NOT NULL,
	"trust_status" "activity_source_trust_status" NOT NULL,
	"score_multiplier_bps" integer NOT NULL,
	"reason" text NOT NULL,
	"administrator_id" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_sources" ADD COLUMN "trust_status" "activity_source_trust_status" DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_sources" ADD COLUMN "score_multiplier_bps" integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_source_trust_changes" ADD CONSTRAINT "activity_source_trust_changes_source_record_id_activity_sources_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."activity_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_source_trust_changes_source_changed_at_idx" ON "activity_source_trust_changes" USING btree ("source_record_id","changed_at");