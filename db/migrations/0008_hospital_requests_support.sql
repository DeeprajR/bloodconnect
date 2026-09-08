-- Triggers, the immutability rule, and the index the duplicate-patient warning
-- will need (§5.4).
--
-- Table privileges come from the default privileges set in migration 0004, so
-- `app_web` already holds them on everything created here.
--
-- Rollback plan: triggers and indexes only; no data is touched.

CREATE TRIGGER centres_set_updated_at
  BEFORE UPDATE ON "hospital"."centres"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER patients_set_updated_at
  BEFORE UPDATE ON "hospital"."patients"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER admissions_set_updated_at
  BEFORE UPDATE ON "hospital"."admissions"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER blood_requests_set_updated_at
  BEFORE UPDATE ON "hospital"."blood_requests"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

-- The IP number is the primary identity of an admission on the ward (§3), and
-- it is immutable after creation. Enforced here rather than in the application
-- because a corrected IP number silently repoints every request already made
-- against that admission.
CREATE OR REPLACE FUNCTION hospital.admissions_ip_no_is_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ip_no IS DISTINCT FROM OLD.ip_no THEN
    RAISE EXCEPTION 'ip_no is immutable after creation (was %, got %)', OLD.ip_no, NEW.ip_no
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER admissions_ip_no_immutable
  BEFORE UPDATE ON "hospital"."admissions"
  FOR EACH ROW EXECUTE FUNCTION hospital.admissions_ip_no_is_immutable();
--> statement-breakpoint

-- A trigram index on the patient's name, for the duplicate warning of §3 and
-- the dashboard search. Human-entered names are misspelled, transliterated and
-- abbreviated; an exact index finds none of that.
CREATE INDEX patients_name_trgm_idx
  ON "hospital"."patients" USING gin (name gin_trgm_ops);
--> statement-breakpoint

-- One centre for this deployment, so `centre_id` has a referent from the first
-- request. Multi-tenant needs no migration, only more rows (§13).
INSERT INTO "hospital"."centres" (id, name)
VALUES ('01930000-0000-7000-8000-000000000001', 'Government Medical College Blood Centre, Kozhikode')
ON CONFLICT (id) DO NOTHING;
