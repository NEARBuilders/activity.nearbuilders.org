CREATE TABLE "activity_source_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_record_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"secret_hash" text NOT NULL,
	"permission" text DEFAULT 'event:write' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "activity_source_api_keys_secret_hash_unique" UNIQUE("secret_hash")
);
--> statement-breakpoint
ALTER TABLE "activity_source_api_keys" ADD CONSTRAINT "activity_source_api_keys_source_record_id_activity_sources_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."activity_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_source_api_keys_source_idx" ON "activity_source_api_keys" USING btree ("source_record_id");