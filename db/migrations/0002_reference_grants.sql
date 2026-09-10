-- Grants on `reference`, and the updated_at triggers for its tables (§5.1).
--
-- §11.5 asks for ownership the database itself enforces. The location hierarchy
-- is the one thing both applications read and neither writes at runtime: it is
-- seeded by the migrator and served to the web app and the bot read-only.
--
-- The line worth defending in review is the last one. Module 4 reads "the bot's
-- progress counters" (§6), but the bot writes those onto `hospital.donor_demand`,
-- so the volunteer dashboard needs no access to the `bot` schema at all, and the
-- web app is given none. A privacy boundary that is a missing grant (§2.10)
-- cannot be crossed by a careless join.

CREATE TRIGGER location_nodes_set_updated_at
  BEFORE UPDATE ON "reference"."location_nodes"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

GRANT USAGE ON SCHEMA "reference" TO app_web, app_bot;
--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA "reference" TO app_web, app_bot;
--> statement-breakpoint

-- Tables added to `reference` by a later migration are read-only to both
-- applications by default, so a new lookup table cannot arrive writable by
-- accident.
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA "reference"
  GRANT SELECT ON TABLES TO app_web, app_bot;
--> statement-breakpoint

-- The bot's schema does not exist yet: `db/migrations-bot` creates it, applied
-- by the bot's own release (§5.9). The revoke that keeps the web app out of it
-- belongs to that set, next to the tables it protects, so it cannot be applied
-- against a schema that is not there.
SELECT 1;
