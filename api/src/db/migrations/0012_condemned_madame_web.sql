ALTER TABLE "activity_binding_sessions" ADD COLUMN "requester_key_hash" text;--> statement-breakpoint
ALTER TABLE "activity_sources" ADD COLUMN "nearbuilders_project_id" text;--> statement-breakpoint
CREATE INDEX "activity_binding_sessions_requester_created_idx" ON "activity_binding_sessions" USING btree ("requester_key_hash","created_at");--> statement-breakpoint
CREATE INDEX "activity_binding_sessions_created_at_idx" ON "activity_binding_sessions" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "activity_sources" ADD CONSTRAINT "activity_sources_nearbuilders_project_id_unique" UNIQUE("nearbuilders_project_id");