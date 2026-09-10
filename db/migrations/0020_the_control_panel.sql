-- The control panel's two tables (§11.9, §14, P10).
--
-- Both exist because of a boundary rather than in spite of one.
--
-- `app_web` holds no grant on the `bot` schema at all (bot migration 0001), so
-- the administration application cannot read the bot's outbox, its jobs or its
-- event log. That is §5.1 working rather than a gap: the bot's half holds donor
-- names and phone numbers, and a panel that could read them would be a second
-- copy of the donor register sitting behind an admin login.
--
-- So the bot **publishes** its health into `process_health`, the same way it
-- already publishes recruitment progress onto `donor_demand`. Counts, ages and
-- versions cross the boundary. Nothing that names a person does.
--
-- `observed_at` is the liveness signal, and it is the reason this is a
-- heartbeat rather than a log. A process that stops stops updating its row, and
-- a stale row is the only way the panel can tell "the bot says everything is
-- fine" from "the bot has not said anything since Tuesday". A status column on
-- its own cannot tell those apart, and the second is exactly the failure §11.9
-- calls silent.
--
-- `request_samples` keeps one row per served request for a rolling window,
-- rather than pre-aggregated counters, because §11.9 asks for p50 and p95 and a
-- counter cannot produce a percentile. `route` holds the pattern and never the
-- path, so no record identifier lands here.
--
-- Rollback plan: forward-only. Two new tables holding no clinical data;
-- reversing is DROP TABLE, and nothing existing is altered.

CREATE TABLE "hospital"."process_health" (
	"process" text PRIMARY KEY NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"contract_version" text NOT NULL,
	"build_id" text,
	"alerts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "process_health_process_check" CHECK (process IN ('web', 'bot')),
	CONSTRAINT "process_health_status_check" CHECK (status IN ('ok', 'degraded', 'down'))
);
--> statement-breakpoint
CREATE TABLE "hospital"."request_samples" (
	"id" uuid PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"surface" text NOT NULL,
	"route" text NOT NULL,
	"method" text NOT NULL,
	"status" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"correlation_id" text,
	CONSTRAINT "request_samples_status_check" CHECK (status >= 100 AND status < 600),
	CONSTRAINT "request_samples_duration_check" CHECK (duration_ms >= 0)
);
--> statement-breakpoint
CREATE INDEX "request_samples_window_idx" ON "hospital"."request_samples" USING btree ("occurred_at" DESC NULLS LAST,"surface");--> statement-breakpoint
CREATE INDEX "request_samples_correlation_idx" ON "hospital"."request_samples" USING btree ("correlation_id");

-- Both processes write their own row and read both rows. The grant cannot
-- separate them, and it does not need to: two uuid-free rows keyed by a name
-- from a CHECK, holding counts. Whichever process last wrote a row is the
-- process whose heartbeat it is, and a stale one is visible as stale.
GRANT SELECT, INSERT, UPDATE ON "hospital"."process_health" TO app_web;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "hospital"."process_health" TO app_bot;--> statement-breakpoint
REVOKE DELETE ON "hospital"."process_health" FROM app_web, app_bot;--> statement-breakpoint

-- The web release serves the requests, so it records them, and it prunes the
-- window it keeps. The bot serves no HTTP at all and has no business here.
GRANT SELECT, INSERT, DELETE ON "hospital"."request_samples" TO app_web;--> statement-breakpoint
REVOKE UPDATE ON "hospital"."request_samples" FROM app_web;--> statement-breakpoint
REVOKE ALL ON "hospital"."request_samples" FROM app_bot;
--> statement-breakpoint

-- A third table both processes touch, so a minor bump (§11.8). Additive from
-- both sides: nothing existing changed shape, and a process running the old
-- version simply does not write a heartbeat.
--
-- Both assert their compiled version against this at boot (§6), so an existing
-- database moves without a re-seed. `value` is jsonb, so the version is a json
-- string rather than a bare literal.
UPDATE "hospital"."app_config" SET value = '"1.3.0"'::jsonb, updated_at = now()
 WHERE key = 'contract.version';
