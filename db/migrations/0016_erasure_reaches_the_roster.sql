-- Erasure has to reach the roster (§12.1, contract 1.3.0).
--
-- §12.1: "Donor deletion nulls profile, channel, phone, location and screening
-- data and **de-identifies** `donor_demand_confirmations`, keeping the donation
-- and bag identifier."
--
-- The bot could not do it. `app_bot` held UPDATE on exactly three columns of
-- that table -- status, acknowledged_at, updated_at -- so a donor who asked to
-- be deleted kept their name and phone number on every roster row they had ever
-- appeared on, indefinitely. The deletion reported success and left the two
-- fields that identify a person untouched.
--
-- The centre cannot do it either: `app_web` has no way to know a bot donor
-- asked to be erased, and the donor id in that table is the bot's internal one
-- (§2.11). So the grant goes to the side that receives the request.
--
-- Narrow on purpose: two columns, and no others. The bot still cannot invent a
-- roster row, cannot change what the counter recorded, and cannot touch the
-- unit number -- which is the half of the row that must survive erasure,
-- because a donation record the blood centre is required to keep must outlive
-- the donor's name being removed from it.
--
-- Additive from both sides, so a minor bump (§11.8).
--
-- Rollback plan: REVOKE the two columns. Erasure then stops reaching the
-- roster, which is the bug this fixes.

GRANT UPDATE (
  donor_name,
  donor_phone
) ON "hospital"."donor_demand_confirmations" TO app_bot;--> statement-breakpoint

-- `value` is jsonb, so the version is a json string rather than a bare literal.
UPDATE "hospital"."app_config" SET value = '"1.3.0"'::jsonb, updated_at = now()
 WHERE key = 'contract.version';
