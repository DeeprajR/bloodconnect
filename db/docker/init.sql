-- Cluster provisioning for local development and CI.
--
-- Roles are cluster-wide objects and production creates them outside the
-- release, so they are not a migration (§5.9). Migrations own schemas, tables
-- and grants; this file owns the roles those grants are made to, and the test
-- database the suite is allowed to truncate.
--
-- The passwords here are development passwords in a file committed to the
-- repository. That is deliberate and safe only because nothing real ever runs
-- against this compose stack.

DO $$
BEGIN
  -- Applies migrations. Owns nothing at runtime; neither application role holds
  -- DDL rights (§5.9).
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migrator') THEN
    CREATE ROLE migrator LOGIN PASSWORD 'migrator';
  END IF;

  -- The web app and the worker: read/write in `hospital`, read in `reference`,
  -- and deliberately nothing at all in `bot` (§5.1).
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_web') THEN
    CREATE ROLE app_web LOGIN PASSWORD 'app_web';
  END IF;

  -- The bot: read/write in `bot`, read in `reference`, and only the contract
  -- columns of `hospital.donor_demand` (§5.1, §6).
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_bot') THEN
    CREATE ROLE app_bot LOGIN PASSWORD 'app_bot';
  END IF;
END
$$;

-- The migrator needs to hand ownership of new objects to nobody in particular;
-- it simply needs to be able to create them in this database.
GRANT CONNECT ON DATABASE blood_connect TO migrator, app_web, app_bot;
GRANT CREATE ON DATABASE blood_connect TO migrator;

-- PostgreSQL 15 revoked CREATE on `public` from everyone but the owner. The
-- shared `set_updated_at()` trigger function lives there, one function for
-- every schema rather than a copy per schema, so the migrator needs it back.
GRANT CREATE, USAGE ON SCHEMA public TO migrator;

-- The suite truncates every table between tests, so it gets its own database
-- and the harness refuses any URL that is not named for testing.
SELECT 'CREATE DATABASE blood_connect_test OWNER postgres'
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'blood_connect_test')\gexec

GRANT CONNECT ON DATABASE blood_connect_test TO migrator, app_web, app_bot;
GRANT CREATE ON DATABASE blood_connect_test TO migrator;

-- Schema-level grants are per database, so the test database needs the same
-- treatment. Without this the suite would run against a schema the migrations
-- could not fully build, and would fail in a way that looks like a code bug.
\connect blood_connect_test
GRANT CREATE, USAGE ON SCHEMA public TO migrator;
