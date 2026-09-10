-- Grants and triggers for the `bot` schema (§5.1, §5.2).
--
-- `app_bot` gets its own schema and nothing else. What it may touch outside it
-- is granted by the **web** release: read-only `reference` (migration 0002 of
-- that set) and exactly the contract columns of `hospital.donor_demand` and
-- `hospital.donor_demand_confirmations` (migration 0010). That split is the
-- point, neither release can widen the other's boundary.
--
-- `event_log` is append-only by grant, the same treatment `hospital.audit_log`
-- gets: a log the application can rewrite is not a log (§14).
--
-- The `set_updated_at` function is defined here as well as in the web set. Two
-- CREATE OR REPLACE statements of an identical function are idempotent, and the
-- alternative is a migration set that fails to apply on its own, which defeats
-- the purpose of having two.
--
-- Rollback plan: grants and triggers only. No data is touched.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA "bot" TO app_bot;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "bot" TO app_bot;
--> statement-breakpoint

-- Append-only, enforced by absence rather than by review.
REVOKE UPDATE, DELETE, TRUNCATE ON "bot"."event_log" FROM app_bot;
--> statement-breakpoint

-- Tables added to `bot` later are usable by the bot by default; anything
-- narrower is granted explicitly by the migration that adds the table.
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA "bot"
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_bot;
--> statement-breakpoint

-- The web application cannot see the donor pool at all. §5.1's privacy boundary
-- is a missing grant, not a convention: a careless join from the centre's
-- screens cannot reach a donor's name or phone number. What the counter is
-- allowed to see about a donor arrives on the roster row, in `hospital`, put
-- there by the bot.
REVOKE ALL ON SCHEMA "bot" FROM app_web;
--> statement-breakpoint

-- `updated_at` is maintained by the database, not the application (§5.2).
CREATE TRIGGER donors_set_updated_at
  BEFORE UPDATE ON "bot"."donors"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER bot_requests_set_updated_at
  BEFORE UPDATE ON "bot"."bot_requests"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER donor_requests_set_updated_at
  BEFORE UPDATE ON "bot"."donor_requests"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER conversation_state_set_updated_at
  BEFORE UPDATE ON "bot"."conversation_state"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER message_outbox_set_updated_at
  BEFORE UPDATE ON "bot"."message_outbox"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER bot_jobs_set_updated_at
  BEFORE UPDATE ON "bot"."bot_jobs"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
