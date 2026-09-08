-- The group the counter actually typed (contract 1.1.0, §4, §7.7).
--
-- Additive, so a minor version bump: both sides understand each other across it
-- and neither needs the other shipped first (§11.8).
--
-- Why it exists. §7.7 recruits nobody whose blood group is only self-declared,
-- and `blood_group_verified_at` is on `bot.donors` -- which `app_web` holds no
-- grant on and never will (§5.1). So the centre, which *is* the authority on
-- what a unit typed as, had no way to say so, and a donor who registered
-- through the bot could never be recruited. The only alternative was trusting a
-- self-declaration, which is exactly what that column exists to prevent.
--
-- The bot reads this when it applies a counter outcome, and verifies the donor
-- from it. Recorded as the resolution of the open question in ADR 0007.
--
-- Rollback plan: one nullable column and one grant. Dropping it loses the typed
-- groups recorded since; nothing else depends on it.

ALTER TABLE "hospital"."donor_demand_confirmations" ADD COLUMN "donated_blood_group" text;--> statement-breakpoint
ALTER TABLE "hospital"."donor_demand_confirmations" ADD CONSTRAINT "donor_demand_confirmations_typed_group_check" CHECK (donated_blood_group IS NULL OR donated_blood_group IN
            ('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'));--> statement-breakpoint

-- The counter may write it; the bot may not. Only the person holding the unit
-- knows what it typed as, and a bot that could set this could verify a donor's
-- group from the donor's own guess.
GRANT UPDATE (donated_blood_group) ON "hospital"."donor_demand_confirmations" TO app_web;
