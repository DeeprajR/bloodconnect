-- The request slip (§3, ADR 0010).
--
-- A doctor raises a request with four fields, blood group, product, units,
-- urgency, and gets back an ID to read aloud to the patient's bystander. The
-- patient is identified later, at the counter. This migration is what makes
-- those four fields sufficient.
--
-- Four changes, and each one removes a reason the old form could not be short:
--
--   * `urgency`            -- what the doctor picks instead of typing a date.
--                             `date_required` is derived from it and kept,
--                             because three of the four levels mean today: the
--                             date cannot order the queue and the level cannot
--                             drive the expiry sweep.
--   * `admission_id` NULL  -- there is no patient at submit any more.
--   * the submitted check  -- no longer demands a patient snapshot or an
--                             indication, because neither exists yet.
--   * the counter, re-keyed -- `DDMMYY-NNNNN` restarts each day, so the
--                             allocator does too (§7.1).
--
-- Existing rows: `draft` stays legal in the status check and old `BR-YYYY-NNNNNN`
-- identifiers stay as they are. Nothing creates either any more. Deleting a
-- draft would destroy the only record that something was intended, and rewriting
-- an issued request's identifier would break every reference to it on paper.
--
-- Rollback plan: the column drops and the check reverts, but any request raised
-- without a patient fails the old constraint. Reversing this after it has been
-- used means deciding what to do with those rows, not just running SQL.

ALTER TABLE "hospital"."blood_requests" ADD COLUMN "urgency" text;--> statement-breakpoint
ALTER TABLE "hospital"."blood_requests" ALTER COLUMN "admission_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "hospital"."blood_requests" ALTER COLUMN "status" SET DEFAULT 'submitted';--> statement-breakpoint

-- Every request that already exists was raised the old way, with a date the
-- doctor typed. Backfilled as `routine` rather than guessed at: nobody can now
-- say which of them was an emergency, and inventing one would put a made-up
-- clinical priority on a real record.
UPDATE "hospital"."blood_requests" SET urgency = 'routine'
 WHERE urgency IS NULL AND status <> 'draft';--> statement-breakpoint

ALTER TABLE "hospital"."blood_requests" DROP CONSTRAINT IF EXISTS "blood_requests_submitted_check";--> statement-breakpoint
ALTER TABLE "hospital"."blood_requests" ADD CONSTRAINT "blood_requests_submitted_check" CHECK (status = 'draft' OR (
        request_id IS NOT NULL
        AND doctor_snapshot IS NOT NULL
        AND submitted_at IS NOT NULL
        AND urgency IS NOT NULL
        AND date_required IS NOT NULL
        AND blood_group IS NOT NULL
        AND product IS NOT NULL
        AND units IS NOT NULL
      ));--> statement-breakpoint

ALTER TABLE "hospital"."blood_requests" ADD CONSTRAINT "blood_requests_patient_check" CHECK (patient_snapshot IS NULL OR admission_id IS NOT NULL);--> statement-breakpoint
ALTER TABLE "hospital"."blood_requests" ADD CONSTRAINT "blood_requests_urgency_check" CHECK (urgency IS NULL OR urgency IN ('emergency', 'very_urgent', 'urgent', 'routine'));--> statement-breakpoint

-- The queue is ordered by urgency and then by how long it has waited, so that
-- is what the index carries. The old (status, date_required) index answered a
-- question the queue no longer asks.
CREATE INDEX IF NOT EXISTS "blood_requests_queue_urgency_idx"
  ON "hospital"."blood_requests" ("status", "urgency", "submitted_at");--> statement-breakpoint

/* -------------------------------------------------------------------------- */
/* The counter, re-keyed to the day (§7.1)                                     */
/* -------------------------------------------------------------------------- */

-- Rebuilt rather than altered: the old table is keyed by year with a year's
-- worth of sequence in it, and there is no honest way to spread that across
-- days. The identifiers already allocated live on the requests themselves, so
-- nothing is lost -- only the allocator's bookmark, which starts again today.
DROP TABLE IF EXISTS "hospital"."blood_request_counters";--> statement-breakpoint

CREATE TABLE "hospital"."blood_request_counters" (
	"day" date PRIMARY KEY NOT NULL,
	"next_value" integer NOT NULL
);--> statement-breakpoint

-- Same grants the table had: the doctor app allocates, and nothing else.
GRANT SELECT, INSERT, UPDATE ON "hospital"."blood_request_counters" TO app_web;
