-- The account update-request queue (§3, ADR 0011 §4).
--
-- The last row of Milestone B, and the only flow in the specification that had
-- no beginning either. P5's plan listed it and it did not get built.
--
-- **Two fields, not three.** §3 describes a queue for the identity fields, and
-- the obvious reading includes the email address. It should not: migration 0005
-- gave email its own flow, confirmed by a link delivered to the proposed
-- address, and that proves the person actually holds it where an admin queue
-- proves only that an administrator agreed. Adding email here would be a weaker
-- second path to the same change, and a weaker second path is the one an
-- attacker uses. So the queue covers the two fields nothing can verify by
-- delivery: the name printed on a request, and the registration number beside
-- it. Both travel onto clinical records, which is why a person cannot simply
-- retype them.
--
-- Nobody may approve their own request. That is enforced in the use case
-- rather than here, because the database sees two uuids and cannot know that a
-- self-approval is the thing being prevented -- but the row records
-- `decided_by`, so an approval that was self-granted is visible afterwards
-- either way.
--
-- Rollback plan: forward-only. A new table with no data and no column altered
-- elsewhere; reversing is DROP TABLE.

CREATE TABLE "hospital"."account_update_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"field" text NOT NULL,
	"current_value" text,
	"proposed_value" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"admin_note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_update_requests_field_check" CHECK (field IN ('full_name', 'provisional_reg')),
	CONSTRAINT "account_update_requests_status_check" CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
	CONSTRAINT "account_update_requests_decided_check" CHECK ((status IN ('pending', 'withdrawn')) = (decided_by IS NULL AND decided_at IS NULL)),
	CONSTRAINT "account_update_requests_value_check" CHECK (length(trim(proposed_value)) > 0),
	CONSTRAINT "account_update_requests_reason_check" CHECK (length(trim(reason)) > 0)
);
--> statement-breakpoint
ALTER TABLE "hospital"."account_update_requests" ADD CONSTRAINT "account_update_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "hospital"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."account_update_requests" ADD CONSTRAINT "account_update_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "hospital"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_update_requests_one_pending_idx" ON "hospital"."account_update_requests" USING btree ("user_id","field") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "account_update_requests_queue_idx" ON "hospital"."account_update_requests" USING btree ("status","created_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "account_update_requests_user_idx" ON "hospital"."account_update_requests" USING btree ("user_id","created_at");--> statement-breakpoint

-- The person raises and withdraws; the admin decides. Both are the web app, so
-- the grant cannot separate them -- §3's safeguards live in the use cases and
-- in `decided_by`, which says afterwards who did it.
--
-- No DELETE. A rejected request is the record of a decision about somebody's
-- clinical identity, and §14 keeps those.
GRANT SELECT, INSERT, UPDATE ON "hospital"."account_update_requests" TO app_web;--> statement-breakpoint
REVOKE DELETE ON "hospital"."account_update_requests" FROM app_web;--> statement-breakpoint

-- The bot has no business in hospital accounts at all.
REVOKE ALL ON "hospital"."account_update_requests" FROM app_bot;
