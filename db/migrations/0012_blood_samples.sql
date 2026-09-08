-- The pre-transfusion compatibility testing sample (§5.4, §15).
--
-- §2.7 calls it that and never "blood sample" -- the wording table exists
-- because the imprecise term is what somebody reaches for under pressure.
--
-- `sample_identifier` is unique **on its own**, not per request. §15 wants it
-- globally unique because the identifier travels on a physical tube between the
-- ward and the laboratory, and two tubes carrying the same label for different
-- patients is exactly the mix-up the compatibility test exists to prevent.
--
-- Rollback plan: one new table with no data. Reversing it is DROP TABLE.

CREATE TABLE "hospital"."blood_samples" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"sample_identifier" text NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"collected_by_doctor_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hospital"."blood_samples" ADD CONSTRAINT "blood_samples_request_id_blood_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "hospital"."blood_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."blood_samples" ADD CONSTRAINT "blood_samples_collected_by_doctor_id_users_id_fk" FOREIGN KEY ("collected_by_doctor_id") REFERENCES "hospital"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "blood_samples_identifier_idx" ON "hospital"."blood_samples" USING btree ("sample_identifier");--> statement-breakpoint
CREATE INDEX "blood_samples_request_idx" ON "hospital"."blood_samples" USING btree ("request_id","collected_at" DESC NULLS LAST);--> statement-breakpoint
CREATE TRIGGER blood_samples_set_updated_at
  BEFORE UPDATE ON "hospital"."blood_samples"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
