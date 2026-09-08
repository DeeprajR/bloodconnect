-- What the counter already collected, in the bot's own bookkeeping (1.2.0).
--
-- The centre records a walk-in -- somebody who gave without ever being in the
-- bot -- in `hospital.walk_in_donations`, which it owns and the bot may only
-- read. This column is the bot's running copy of that count, synced by the
-- ticker.
--
-- It is kept beside `units_needed` rather than subtracted from it, so the
-- original need stays legible: three units were wanted, one walked in, and two
-- donors are still worth calling. Every question of the form "does this still
-- need people?" counts it, because the alternative is calling real donors in
-- for blood the shelf already has.
--
-- No grant changes: this is the bot's own schema. The read it is derived from
-- is granted in the web release, migration 0015.
--
-- Rollback plan: one column with a default. Dropping it makes the bot blind to
-- walk-ins again; nothing else depends on it.

ALTER TABLE "bot"."bot_requests" ADD COLUMN "walk_in_units" integer DEFAULT 0 NOT NULL;