-- The donor's qualification, worked out from their answers and kept.
--
-- Until now the whole judgement was recomputed inside the wave query every time
-- one ran. That worked, but it left no answer to two questions an operator
-- actually asks: why was this person never contacted, and how many of the people
-- who signed up can we use at all. Neither is answerable from a predicate that
-- exists only for the duration of a SELECT.
--
-- So the parts of the judgement that come from what the donor told us are
-- decided once, when they tell us, and written here:
--
--   qualified      their answers raise nothing that would stop them
--   not_qualified  a threshold does: too young, too old, under the weight
--   flagged        an answer needs a person to look before they are asked
--
-- `qualification_reason` carries the why in the donor's own terms, so the bot can
-- say it back to them rather than leaving them wondering.
--
-- What is deliberately NOT in here is the donation window. How long since
-- somebody last gave is a fact about today's date, not about their answers, and
-- a boolean written in June is wrong by September. `next_eligible_on` stays the
-- authority on that and is still checked live in every wave. Mixing the two is
-- how a stored judgement goes quietly stale.
--
-- The default is `qualified` because the existing rows were all selectable
-- before this migration ran, and a default of anything else would silently stop
-- recruiting the entire pool on deploy. The flagged ones are then corrected
-- below from the column that already recorded them.
--
-- No grant changes: this is the bot's own schema, and `app_bot` already holds
-- the table.
--
-- Rollback plan: three columns, an index and a check. Dropping them returns the
-- judgement to the wave query, which still performs every one of these checks
-- itself. Nothing is lost but the record of why.

ALTER TABLE "bot"."donors" ADD COLUMN "qualification_status" text DEFAULT 'qualified' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot"."donors" ADD COLUMN "qualification_reason" text;--> statement-breakpoint
ALTER TABLE "bot"."donors" ADD COLUMN "qualified_at" timestamp with time zone;--> statement-breakpoint

-- A donor already flagged by the durable questions is flagged here too, rather
-- than inheriting the default and becoming selectable on the strength of a
-- migration.
UPDATE "bot"."donors"
   SET "qualification_status" = 'flagged',
       "qualification_reason" = 'An answer to the health questions needs checking.'
 WHERE "durable_flag_status" <> 'clear';--> statement-breakpoint

CREATE INDEX "donors_qualified_idx" ON "bot"."donors" USING btree ("blood_group","qualification_status","next_eligible_on");--> statement-breakpoint
ALTER TABLE "bot"."donors" ADD CONSTRAINT "donors_qualification_check" CHECK (qualification_status IN ('qualified', 'not_qualified', 'flagged'));
