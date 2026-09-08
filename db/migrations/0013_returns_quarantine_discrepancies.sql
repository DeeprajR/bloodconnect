-- Returns, quarantine, discards and the case-3 discrepancy (§4, §5.5, §7.5).
--
-- The part of this system most likely to put the wrong unit into a patient, so
-- three rules live in the database rather than only in a use case:
--
--   * bag_returns_restock_check        -- a unit whose time out of storage is
--                                         unknown, or past the limit, can never
--                                         be restocked. No screen and no future
--                                         code path can put one back on the shelf.
--   * bag_discards_route_check         -- a disposal route is required. A status
--                                         change is not the end of a bag (§12.1).
--   * tag_discrepancies_resolved_check -- resolved means a person, a finding and
--                                         a note, all three. A row closed
--                                         without them records that somebody
--                                         made it go away, not what they found.
--
-- `tag_discrepancies` is touched by no scheduled job at all, and that absence is
-- deliberate (§4): it never auto-resolves and never expires.
--
-- Rollback plan: forward-only. New tables with no data; reversing is DROP TABLE
-- in reverse dependency order, and nothing existing is altered.

CREATE TABLE "hospital"."bag_discards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bag_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"disposal_route" text NOT NULL,
	"note" text,
	"discarded_by" uuid,
	"discarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bag_discards_route_check" CHECK (length(trim(disposal_route)) > 0)
);
--> statement-breakpoint
CREATE TABLE "hospital"."bag_quarantines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bag_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"resolved_by" uuid,
	"note" text,
	CONSTRAINT "bag_quarantines_resolution_check" CHECK (resolution IS NULL OR resolution IN ('available', 'discarded')),
	CONSTRAINT "bag_quarantines_resolved_check" CHECK ((resolved_at IS NULL) = (resolution IS NULL))
);
--> statement-breakpoint
CREATE TABLE "hospital"."bag_returns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bag_id" uuid NOT NULL,
	"returned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"out_of_storage_band" text NOT NULL,
	"cold_chain_documented" boolean DEFAULT false NOT NULL,
	"outcome" text NOT NULL,
	"note" text,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bag_returns_band_check" CHECK (out_of_storage_band IN ('under_30m', '30m_to_limit', 'over_limit', 'unknown')),
	CONSTRAINT "bag_returns_outcome_check" CHECK (outcome IN ('restock', 'quarantine', 'discard')),
	CONSTRAINT "bag_returns_restock_check" CHECK (outcome <> 'restock' OR out_of_storage_band = 'under_30m')
);
--> statement-breakpoint
CREATE TABLE "hospital"."tag_discrepancies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tag_uid" text NOT NULL,
	"presented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"presented_by" uuid,
	"conflicting_bag_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"finding" text,
	"note" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tag_discrepancies_status_check" CHECK (status IN ('open', 'resolved')),
	CONSTRAINT "tag_discrepancies_finding_check" CHECK (finding IS NULL OR finding IN ('duplicate_tag', 'bag_missing', 'mis_scan')),
	CONSTRAINT "tag_discrepancies_resolved_check" CHECK ((status = 'resolved') = (resolved_at IS NOT NULL AND finding IS NOT NULL
                                    AND resolved_by IS NOT NULL AND note IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "hospital"."bag_discards" ADD CONSTRAINT "bag_discards_bag_id_blood_bags_id_fk" FOREIGN KEY ("bag_id") REFERENCES "hospital"."blood_bags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."bag_discards" ADD CONSTRAINT "bag_discards_discarded_by_users_id_fk" FOREIGN KEY ("discarded_by") REFERENCES "hospital"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."bag_quarantines" ADD CONSTRAINT "bag_quarantines_bag_id_blood_bags_id_fk" FOREIGN KEY ("bag_id") REFERENCES "hospital"."blood_bags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."bag_quarantines" ADD CONSTRAINT "bag_quarantines_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "hospital"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."bag_returns" ADD CONSTRAINT "bag_returns_bag_id_blood_bags_id_fk" FOREIGN KEY ("bag_id") REFERENCES "hospital"."blood_bags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."bag_returns" ADD CONSTRAINT "bag_returns_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "hospital"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."tag_discrepancies" ADD CONSTRAINT "tag_discrepancies_tag_uid_rfid_tags_tag_uid_fk" FOREIGN KEY ("tag_uid") REFERENCES "hospital"."rfid_tags"("tag_uid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."tag_discrepancies" ADD CONSTRAINT "tag_discrepancies_presented_by_users_id_fk" FOREIGN KEY ("presented_by") REFERENCES "hospital"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."tag_discrepancies" ADD CONSTRAINT "tag_discrepancies_conflicting_bag_id_blood_bags_id_fk" FOREIGN KEY ("conflicting_bag_id") REFERENCES "hospital"."blood_bags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."tag_discrepancies" ADD CONSTRAINT "tag_discrepancies_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "hospital"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bag_discards_bag_idx" ON "hospital"."bag_discards" USING btree ("bag_id");--> statement-breakpoint
CREATE INDEX "bag_discards_when_idx" ON "hospital"."bag_discards" USING btree ("discarded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "bag_quarantines_open_idx" ON "hospital"."bag_quarantines" USING btree ("bag_id") WHERE resolved_at IS NULL;--> statement-breakpoint
CREATE INDEX "bag_quarantines_ageing_idx" ON "hospital"."bag_quarantines" USING btree ("opened_at") WHERE resolved_at IS NULL;--> statement-breakpoint
CREATE INDEX "bag_returns_bag_idx" ON "hospital"."bag_returns" USING btree ("bag_id","returned_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tag_discrepancies_open_idx" ON "hospital"."tag_discrepancies" USING btree ("status","presented_at");--> statement-breakpoint
CREATE TRIGGER tag_discrepancies_set_updated_at
  BEFORE UPDATE ON "hospital"."tag_discrepancies"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

-- Append-only, like every other clinical record here: a return, a discard and a
-- quarantine are statements about what happened to a unit of human blood, and
-- the application holds no DELETE on any of them (§14).
REVOKE DELETE ON "hospital"."bag_returns" FROM app_web;
--> statement-breakpoint
REVOKE DELETE ON "hospital"."bag_discards" FROM app_web;
--> statement-breakpoint
REVOKE DELETE ON "hospital"."bag_quarantines" FROM app_web;
--> statement-breakpoint
REVOKE DELETE ON "hospital"."tag_discrepancies" FROM app_web;
--> statement-breakpoint

-- A discard and a return are written once and never edited. A correction is a
-- new record about the bag, not a rewrite of where its contents went.
REVOKE UPDATE ON "hospital"."bag_discards" FROM app_web;
--> statement-breakpoint
REVOKE UPDATE ON "hospital"."bag_returns" FROM app_web;
