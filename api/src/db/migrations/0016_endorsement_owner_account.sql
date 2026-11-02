ALTER TABLE "activity_event_endorsements" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_event_endorsements" ADD COLUMN "owner_account_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_event_endorsements_event_owner_idx" ON "activity_event_endorsements" USING btree ("event_id","owner_account_id");--> statement-breakpoint
CREATE INDEX "activity_event_endorsements_owner_idx" ON "activity_event_endorsements" USING btree ("owner_account_id");--> statement-breakpoint
CREATE INDEX "activity_event_endorsements_user_idx" ON "activity_event_endorsements" USING btree ("user_id");