ALTER TABLE "activity_signing_identities" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "activity_signing_identities" ADD COLUMN "retired_by" text;--> statement-breakpoint
ALTER TABLE "activity_signing_identities" ADD COLUMN "retirement_reason" text;