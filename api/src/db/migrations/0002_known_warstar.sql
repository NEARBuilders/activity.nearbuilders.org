CREATE TYPE "public"."activity_source_approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."activity_source_review_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TABLE "activity_event_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_record_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"point_value" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_source_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_record_id" uuid NOT NULL,
	"decision" "activity_source_review_decision" NOT NULL,
	"reason" text NOT NULL,
	"administrator_id" text NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"display_name" text NOT NULL,
	"near_account_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"approval_status" "activity_source_approval_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"review_reason" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_sources_source_id_unique" UNIQUE("source_id"),
	CONSTRAINT "activity_sources_near_account_id_unique" UNIQUE("near_account_id")
);
--> statement-breakpoint
ALTER TABLE "activity_event_types" ADD CONSTRAINT "activity_event_types_source_record_id_activity_sources_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."activity_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_source_reviews" ADD CONSTRAINT "activity_source_reviews_source_record_id_activity_sources_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."activity_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_event_types_source_name_idx" ON "activity_event_types" USING btree ("source_record_id","name");--> statement-breakpoint
CREATE INDEX "activity_source_reviews_source_reviewed_at_idx" ON "activity_source_reviews" USING btree ("source_record_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "activity_sources_organization_id_idx" ON "activity_sources" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "activity_sources_approval_status_idx" ON "activity_sources" USING btree ("approval_status");