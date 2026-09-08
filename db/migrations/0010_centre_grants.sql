-- Column-level grants on the shared contract, and the triggers and seeds the
-- register needs (§5.1, §5.2, §5.6, §6).
--
-- This is the file §11.2 asks for. It names a one-sided change to
-- `donor_demand` as the single most likely way this system breaks in
-- production, and the defence is three independent copies of the same rule:
--
--   1. `packages/contract` exports the ownership as data, asserted in tests.
--   2. These grants make the wrong write fail at the database, in every code
--      path, including ones nobody has written yet.
--   3. The use cases only ever set their own columns.
--
-- The middle one is the only one that still holds when the application logic is
-- wrong, which is exactly the case worth defending against.
--
-- Note that `app_web` starts with full table privileges here, because migration
-- 0004 set default privileges for everything created in `hospital`. So the two
-- contract tables are REVOKEd first and re-granted narrowly. A grant that is
-- only ever added is a grant that quietly widens.
--
-- Rollback plan: grants, triggers and two seed rows. Re-running the previous
-- state restores the grants; the seeds are idempotent and carry no clinical
-- data.

/* -------------------------------------------------------------------------- */
/* updated_at, maintained by the database (§5.2)                               */
/* -------------------------------------------------------------------------- */

CREATE TRIGGER centre_settings_set_updated_at
  BEFORE UPDATE ON "hospital"."centre_settings"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER product_shelf_lives_set_updated_at
  BEFORE UPDATE ON "hospital"."product_shelf_lives"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER blood_bags_set_updated_at
  BEFORE UPDATE ON "hospital"."blood_bags"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER rfid_tags_set_updated_at
  BEFORE UPDATE ON "hospital"."rfid_tags"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER centre_decisions_set_updated_at
  BEFORE UPDATE ON "hospital"."centre_decisions"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER donor_demand_set_updated_at
  BEFORE UPDATE ON "hospital"."donor_demand"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER donor_demand_confirmations_set_updated_at
  BEFORE UPDATE ON "hospital"."donor_demand_confirmations"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

/* -------------------------------------------------------------------------- */
/* The register is append-mostly: a decision is never edited                   */
/* -------------------------------------------------------------------------- */

-- A decision, once made, is a clinical record of what the centre answered. It
-- is corrected by a later action against the request, never by rewriting the
-- row -- so the application holds no UPDATE or DELETE on either table, the same
-- treatment `audit_log` gets (§2.6, §14).
REVOKE UPDATE, DELETE ON "hospital"."centre_decisions" FROM app_web;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "hospital"."decision_bags" FROM app_web;
--> statement-breakpoint

-- `tag_assignments` is append-only in the sense that a row is never removed and
-- never re-pointed: closing an assignment sets `released_at`, which is an
-- UPDATE, so UPDATE stays. DELETE does not -- "what was on this tag in March?"
-- has to remain answerable after the tag has been reused twice (§4).
REVOKE DELETE ON "hospital"."tag_assignments" FROM app_web;
--> statement-breakpoint

/* -------------------------------------------------------------------------- */
/* donor_demand -- centre to bot (§7)                                          */
/* -------------------------------------------------------------------------- */

REVOKE INSERT, UPDATE, DELETE ON "hospital"."donor_demand" FROM app_web;
--> statement-breakpoint

-- The centre raises and cancels. Everything describing the need is its own, and
-- it physically cannot set a recruitment counter: `confirmed_units` says how
-- many donors have promised to come, and only the bot knows that.
GRANT INSERT ON "hospital"."donor_demand" TO app_web;
--> statement-breakpoint
GRANT UPDATE (
  status,
  notes,
  updated_at
) ON "hospital"."donor_demand" TO app_web;
--> statement-breakpoint

-- The bot never creates a demand and never deletes one: it reads what the
-- centre raised and writes back progress. No INSERT, no DELETE, and UPDATE on
-- exactly the columns §7 gives it -- so the bot physically cannot set `units`.
GRANT SELECT ON "hospital"."donor_demand" TO app_bot;
--> statement-breakpoint
GRANT UPDATE (
  bot_public_id,
  imported_at,
  donors_notified,
  confirmed_units,
  waitlisted_units,
  completed_units,
  status,
  updated_at
) ON "hospital"."donor_demand" TO app_bot;
--> statement-breakpoint

/* -------------------------------------------------------------------------- */
/* donor_demand_confirmations -- bot to centre to bot (§7)                     */
/* -------------------------------------------------------------------------- */

REVOKE INSERT, UPDATE, DELETE ON "hospital"."donor_demand_confirmations" FROM app_web;
--> statement-breakpoint

-- The counter is the authority on who actually gave blood (§4), and that is the
-- whole of what it may write here. It cannot invent a roster row: someone who
-- never confirmed in the bot is recorded as a walk-in, which is a different
-- flow with its own record, rather than a fabricated confirmation.
GRANT UPDATE (
  status,
  donated_at,
  bag_identifier,
  marked_by,
  updated_at
) ON "hospital"."donor_demand_confirmations" TO app_web;
--> statement-breakpoint

-- The bot creates the roster row, so INSERT is a whole-row grant -- Postgres has
-- no column-level INSERT. That is exactly why `packages/contract` asserts the
-- insertable column list as well: this grant cannot express it.
GRANT SELECT, INSERT ON "hospital"."donor_demand_confirmations" TO app_bot;
--> statement-breakpoint
GRANT UPDATE (
  acknowledged_at,
  status,
  updated_at
) ON "hospital"."donor_demand_confirmations" TO app_bot;
--> statement-breakpoint

/* -------------------------------------------------------------------------- */
/* Seeds: shelf lives and the single settings row                              */
/* -------------------------------------------------------------------------- */

-- Plausible defaults, and configuration rather than constants (§4, §12): CPDA-1
-- whole blood at 35 days, red cells in additive solution at 42, platelets at 5,
-- and the two frozen components at a year. The centre corrects these on its own
-- settings screen, and a correction is a row rather than a deploy.
INSERT INTO "hospital"."product_shelf_lives" (product, shelf_life_days) VALUES
  ('whole_blood', 35),
  ('prbc', 42),
  ('platelet_concentrate', 5),
  ('ffp', 365),
  ('cryoprecipitate', 365)
ON CONFLICT (product) DO NOTHING;
--> statement-breakpoint

-- The single row (§5.5), with no district yet.
--
-- The district is a foreign key into `reference.location_nodes`, and the
-- hierarchy is loaded by the seed, which runs after the migrations. Naming
-- Kozhikode here would make a fresh database fail to migrate -- so the seed
-- sets it, and the demand use case refuses to raise a demand until it is set
-- rather than sending donors an address with a hole in it.
INSERT INTO "hospital"."centre_settings"
  (id, centre_id, hospital_name, address, min_units_per_group, return_time_limit_minutes)
VALUES (
  1,
  '01930000-0000-7000-8000-000000000001',
  'Government Medical College Blood Centre, Kozhikode',
  'Government Medical College, Medical College PO, Kozhikode, Kerala 673008',
  25,
  30
)
ON CONFLICT (id) DO NOTHING;
