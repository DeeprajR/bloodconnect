-- Grants and triggers for the `hospital` schema (§5.1, §5.2).
--
-- Two things the application cannot undo by being wrong:
--
--  1. `audit_log` is append-only. `app_web` may INSERT and SELECT and holds no
--     UPDATE or DELETE, so a log entry cannot be edited or quietly removed by
--     any code path, including a future one written by someone in a hurry. A log
--     the application can rewrite is not a log (§14).
--  2. `app_bot` gets USAGE on the schema and no table privilege at all. The two
--     contract tables arrive in P3 and grant exactly their own columns (§5.1);
--     until then the bot can see that `hospital` exists and nothing inside it.
--
-- Rollback plan: these are grants and triggers only. Re-running the previous
-- state restores them. No data is touched.

GRANT USAGE ON SCHEMA "hospital" TO app_web;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "hospital" TO app_web;
--> statement-breakpoint

-- Append-only, enforced by absence rather than by review.
REVOKE UPDATE, DELETE, TRUNCATE ON "hospital"."audit_log" FROM app_web;
--> statement-breakpoint

-- Tables added to `hospital` later are readable and writable by the web app by
-- default; anything narrower is granted explicitly by the migration that adds
-- the table, which is how `donor_demand` gets its column-level treatment.
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA "hospital"
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_web;
--> statement-breakpoint

-- The bot can reach the schema, and nothing in it. §5.1's privacy boundary is a
-- missing grant, not a convention: a careless join cannot cross it.
GRANT USAGE ON SCHEMA "hospital" TO app_bot;
--> statement-breakpoint

-- `updated_at` is maintained by a trigger, not by the application (§5.2), so it
-- is true even when a row is fixed by hand at 2am. `audit_log` has no
-- `updated_at` because nothing ever updates it.
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON "hospital"."users"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER sessions_set_updated_at
  BEFORE UPDATE ON "hospital"."sessions"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER auth_rate_limits_set_updated_at
  BEFORE UPDATE ON "hospital"."auth_rate_limits"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER app_config_set_updated_at
  BEFORE UPDATE ON "hospital"."app_config"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
