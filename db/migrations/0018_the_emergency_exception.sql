-- Recording that a request was answered before anybody named the patient
-- (§4, ADR 0010).
--
-- A unit leaving the fridge has to be traceable to a named person. **Emergency
-- is the only exception**, because waiting for a bystander to arrive before
-- releasing units in a real emergency is the worse failure — and the refusal
-- for every other urgency now lives in `decideRequest` rather than in a
-- convention.
--
-- The fact is stored rather than inferred. Working it out later from "does this
-- request have a patient?" gives the wrong answer as soon as one is attached,
-- which is the whole point of the exception: it gets completed. By then the
-- only trace that units went out against an unidentified patient would be gone.
--
-- `false` for every existing row, which is true of all of them: before ADR 0010
-- a request could not be submitted without a patient at all.
--
-- Rollback plan: one boolean with a default. Dropping it loses which decisions
-- were taken on the exception; nothing depends on it structurally.

ALTER TABLE "hospital"."centre_decisions"
  ADD COLUMN "patient_unidentified" boolean DEFAULT false NOT NULL;
