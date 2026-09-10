-- The panel can say which migrations this database has (§11.9, P10).
--
-- "Which configuration is this deployment actually running" is the first
-- question of most incidents, and half of that answer is the migration list.
-- The panel rendered it as zero, because `app_web` holds no grant on the
-- migrator's own bookkeeping schema and the query was being swallowed by the
-- catch that keeps this page rendering when the database is unhappy.
--
-- Read-only, and only this table. It holds a hash and a timestamp per applied
-- migration: no clinical data, nothing about a person, and nothing an
-- application could change to its advantage. The migrator keeps sole ownership
-- of writing it, which is the property that matters.

GRANT USAGE ON SCHEMA "drizzle" TO app_web;--> statement-breakpoint
GRANT SELECT ON "drizzle"."__drizzle_migrations" TO app_web;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "drizzle"."__drizzle_migrations" FROM app_web;--> statement-breakpoint

-- The bot has its own migration bookkeeping in its own schema and no reason to
-- read this one.
REVOKE ALL ON SCHEMA "drizzle" FROM app_bot;
