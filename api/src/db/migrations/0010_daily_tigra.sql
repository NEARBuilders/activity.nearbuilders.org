CREATE TABLE "activity_github_actor_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"integration_id" uuid NOT NULL,
	"github_login" text NOT NULL,
	"near_account_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_github_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_record_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"merged_pull_requests_enabled" boolean DEFAULT true NOT NULL,
	"closed_issues_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_github_quarantine" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"integration_id" uuid NOT NULL,
	"github_event_id" text NOT NULL,
	"repository" text NOT NULL,
	"github_login" text NOT NULL,
	"event_type" text NOT NULL,
	"reason" text NOT NULL,
	"payload_json" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_github_repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"integration_id" uuid NOT NULL,
	"owner" text NOT NULL,
	"repository" text NOT NULL,
	"etag" text,
	"poll_interval_seconds" integer DEFAULT 60 NOT NULL,
	"next_poll_at" timestamp with time zone,
	"last_polled_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_github_actor_mappings" ADD CONSTRAINT "activity_github_actor_mappings_integration_id_activity_github_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."activity_github_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_github_integrations" ADD CONSTRAINT "activity_github_integrations_source_record_id_activity_sources_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."activity_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_github_quarantine" ADD CONSTRAINT "activity_github_quarantine_integration_id_activity_github_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."activity_github_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_github_repositories" ADD CONSTRAINT "activity_github_repositories_integration_id_activity_github_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."activity_github_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_github_actor_mappings_integration_login_idx" ON "activity_github_actor_mappings" USING btree ("integration_id","github_login");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_github_integrations_source_idx" ON "activity_github_integrations" USING btree ("source_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_github_quarantine_integration_event_idx" ON "activity_github_quarantine" USING btree ("integration_id","github_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_github_repositories_integration_repository_idx" ON "activity_github_repositories" USING btree ("integration_id","owner","repository");--> statement-breakpoint
CREATE INDEX "activity_github_repositories_next_poll_idx" ON "activity_github_repositories" USING btree ("next_poll_at");