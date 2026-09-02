CREATE TYPE "public"."activity_signing_identity_binding_status" AS ENUM('pending', 'bound');--> statement-breakpoint
CREATE TABLE "activity_signing_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_record_id" uuid NOT NULL,
	"public_key" text NOT NULL,
	"encrypted_private_key" text NOT NULL,
	"encryption_iv" text NOT NULL,
	"encryption_auth_tag" text NOT NULL,
	"encryption_key_version" text NOT NULL,
	"binding_status" "activity_signing_identity_binding_status" DEFAULT 'pending' NOT NULL,
	"bound_near_account_id" text,
	"bound_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "activity_signing_identities_public_key_unique" UNIQUE("public_key")
);
--> statement-breakpoint
ALTER TABLE "activity_signing_identities" ADD CONSTRAINT "activity_signing_identities_source_record_id_activity_sources_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."activity_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_signing_identities_active_source_idx" ON "activity_signing_identities" USING btree ("source_record_id") WHERE "activity_signing_identities"."retired_at" is null;