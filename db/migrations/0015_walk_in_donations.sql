-- Walk-in donations, and why they are not confirmation rows (§4, contract 1.2.0).
--
-- `recordWalkIn` first inserted a row into `donor_demand_confirmations`, which
-- is what the architecture note suggested. The database refused it the moment
-- the code ran as `app_web` rather than as the test suite's `migrator`:
--
--     permission denied for table donor_demand_confirmations
--
-- and the refusal was right. §5.1 gives the centre SELECT and five UPDATE
-- columns there and no INSERT at all, because the bot creates the roster and
-- the centre records what happened at the counter. A centre that could invent
-- confirmations could inflate the counters the bot owns.
--
-- So a walk-in is the centre's own record, in the centre's own half. The bot
-- gets SELECT and nothing more: a unit already collected is a unit it must stop
-- recruiting for, and without that visibility a demand covered by walk-ins goes
-- on calling real people in for blood the shelf already has.
--
-- Additive from both sides -- a new table, no column moved -- so a minor
-- contract bump (§11.8).
--
-- Rollback plan: forward-only. A new table with no data; reversing is DROP
-- TABLE, and nothing existing is altered.

CREATE TABLE "hospital"."walk_in_donations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"demand_id" uuid NOT NULL,
	"donor_name" text NOT NULL,
	"donor_phone" text NOT NULL,
	"blood_group" text NOT NULL,
	"bag_identifier" text NOT NULL,
	"donated_on" date NOT NULL,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "walk_in_donations_group_check" CHECK (blood_group IN ('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'))
);
--> statement-breakpoint
ALTER TABLE "hospital"."walk_in_donations" ADD CONSTRAINT "walk_in_donations_demand_id_donor_demand_id_fk" FOREIGN KEY ("demand_id") REFERENCES "hospital"."donor_demand"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "walk_in_donations_demand_idx" ON "hospital"."walk_in_donations" USING btree ("demand_id");
--> statement-breakpoint

-- The centre writes it; nobody rewrites it. A donation is a statement about a
-- unit of human blood that left a real person's arm (§14).
GRANT SELECT, INSERT ON "hospital"."walk_in_donations" TO app_web;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "hospital"."walk_in_donations" FROM app_web;--> statement-breakpoint

-- The bot reads, and only reads. It has no business recording who gave blood.
GRANT SELECT ON "hospital"."walk_in_donations" TO app_bot;--> statement-breakpoint

-- Both processes assert their compiled contract version against this at boot
-- (§6), so an existing database moves without a re-seed.
-- `value` is jsonb, so the version is a json string rather than a bare literal.
UPDATE "hospital"."app_config" SET value = '"1.2.0"'::jsonb, updated_at = now()
 WHERE key = 'contract.version';
