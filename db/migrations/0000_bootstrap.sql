-- Bootstrap: extensions and the shared trigger function.
--
-- Roles are not created here. They are cluster-wide objects and production
-- provisions them outside the release (§5.9); `db/docker/init.sql` creates them
-- for local development and CI. This migration and the ones after it own
-- schemas, tables and grants, and nothing else.
--
-- Rollback plan: dropping the extensions and the function is safe only while no
-- table depends on them, which is true of this migration alone. From 0002
-- onwards, rolling back means restoring a backup.

-- citext gives `users.email` a case-insensitive unique index without a
-- functional index on every comparison (§5.3).
CREATE EXTENSION IF NOT EXISTS citext;

-- pg_trgm backs the duplicate-patient warning's fuzzy name match (§5.4) and the
-- location type-ahead's search (§5.8). Both are searches over human-entered
-- names, where an exact index is the wrong tool.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

-- Every table carries `updated_at timestamptz not null` maintained by a trigger
-- (§5.2). A trigger rather than an application convention, because "the row was
-- last touched at" must be true even when a fix is applied by hand at 2am.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
