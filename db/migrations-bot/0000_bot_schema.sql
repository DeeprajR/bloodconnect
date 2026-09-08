-- The `bot` schema (§5.7), the bot release's own migration set (§5.9).
--
-- This set creates the `bot` schema and nothing else. The two shared contract
-- tables live in `hospital` and are created only by `db/migrations`, applied by
-- the web release -- `pnpm check:bot-migrations` fails the build if
-- `donor_demand` ever appears in this folder (§2.1).
--
-- The `reference` hierarchy is the one thing crossed into, read-only, and by
-- foreign key rather than by copy: a donor's district and the centre's district
-- must be the same identifier or proximity ordering means nothing (§5.8).
--
-- Rollback plan: forward-only. New schema with no data; reversing it is
-- DROP SCHEMA bot CASCADE, and nothing outside the schema is altered.

CREATE SCHEMA IF NOT EXISTS "bot";
--> statement-breakpoint
CREATE TABLE "bot"."bot_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_error" text,
	"correlation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_jobs_status_check" CHECK (status IN ('pending', 'running', 'done', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "bot"."bot_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"demand_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"blood_group" text NOT NULL,
	"product" text NOT NULL,
	"units_needed" integer NOT NULL,
	"confirmed_count" integer DEFAULT 0 NOT NULL,
	"waitlisted_count" integer DEFAULT 0 NOT NULL,
	"completed_count" integer DEFAULT 0 NOT NULL,
	"needed_by" date NOT NULL,
	"hospital_snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"next_wave_at" timestamp with time zone,
	"wave_no" integer DEFAULT 0 NOT NULL,
	"closed_at" timestamp with time zone,
	"closure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_requests_status_check" CHECK (status IN ('open', 'fulfilled', 'completed', 'cancelled', 'expired')),
	CONSTRAINT "bot_requests_units_check" CHECK (units_needed >= 1),
	CONSTRAINT "bot_requests_counts_check" CHECK (confirmed_count >= 0 AND waitlisted_count >= 0 AND completed_count >= 0),
	CONSTRAINT "bot_requests_confirmed_cap" CHECK (confirmed_count <= units_needed),
	CONSTRAINT "bot_requests_closed_check" CHECK ((closed_at IS NULL) = (closure_reason IS NULL))
);
--> statement-breakpoint
CREATE TABLE "bot"."conversation_state" (
	"id" uuid PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"channel_user_id" text NOT NULL,
	"flow" text NOT NULL,
	"step" text NOT NULL,
	"draft" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot"."donor_channels" (
	"donor_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"channel_user_id" text NOT NULL,
	"opted_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "donor_channels_donor_id_channel_pk" PRIMARY KEY("donor_id","channel")
);
--> statement-breakpoint
CREATE TABLE "bot"."donor_consents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"donor_id" uuid NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"wording_version" text NOT NULL,
	"values_snapshot" jsonb NOT NULL,
	"withdrawn_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bot"."donor_phones" (
	"donor_id" uuid NOT NULL,
	"e164" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "donor_phones_donor_id_e164_pk" PRIMARY KEY("donor_id","e164")
);
--> statement-breakpoint
CREATE TABLE "bot"."donor_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bot_request_id" uuid NOT NULL,
	"donor_id" uuid NOT NULL,
	"status" text DEFAULT 'NOTIFIED' NOT NULL,
	"wave_no" integer NOT NULL,
	"notified_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"screening_index" integer DEFAULT 0 NOT NULL,
	"screening_answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confirmed_at" timestamp with time zone,
	"terminal_at" timestamp with time zone,
	"card_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "donor_requests_status_check" CHECK (status IN ('NOTIFIED', 'ACCEPTED', 'SCREENING', 'CONFIRMED', 'REQUEST_FILLED',
                     'DECLINED', 'DEFERRED', 'COMPLETED', 'NO_SHOW', 'CANCELLED')),
	CONSTRAINT "donor_requests_screening_index_check" CHECK (screening_index >= 0)
);
--> statement-breakpoint
CREATE TABLE "bot"."donor_screening_answers" (
	"donor_id" uuid NOT NULL,
	"question_key" text NOT NULL,
	"answer" text NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "donor_screening_answers_donor_id_question_key_pk" PRIMARY KEY("donor_id","question_key")
);
--> statement-breakpoint
CREATE TABLE "bot"."donors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"dob" date NOT NULL,
	"sex" text NOT NULL,
	"blood_group" text NOT NULL,
	"blood_group_verified_at" timestamp with time zone,
	"weight_band" text NOT NULL,
	"weight_kg" integer NOT NULL,
	"district_id" text,
	"city_id" text,
	"town_id" text,
	"locality_id" text,
	"district_text" text,
	"city_text" text,
	"town_text" text,
	"locality_text" text,
	"last_donated_on" date,
	"next_eligible_on" date,
	"durable_flag_status" text DEFAULT 'clear' NOT NULL,
	"snooze_until" date,
	"opted_out_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"consent_current_at" timestamp with time zone,
	"language" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "donors_sex_check" CHECK (sex IN ('female', 'male', 'other')),
	CONSTRAINT "donors_group_check" CHECK (blood_group IN ('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+')),
	CONSTRAINT "donors_weight_band_check" CHECK (weight_band IN ('under_45', '45_50', '50_60', '60_70', '70_plus')),
	CONSTRAINT "donors_flag_check" CHECK (durable_flag_status IN ('clear', 'flagged')),
	CONSTRAINT "donors_weight_check" CHECK (weight_kg >= 0)
);
--> statement-breakpoint
CREATE TABLE "bot"."event_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"event" text NOT NULL,
	"correlation_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot"."message_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"channel_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_outbox_status_check" CHECK (status IN ('pending', 'sent', 'failed', 'abandoned')),
	CONSTRAINT "message_outbox_attempts_check" CHECK (attempts >= 0)
);
--> statement-breakpoint
ALTER TABLE "bot"."donor_channels" ADD CONSTRAINT "donor_channels_donor_id_donors_id_fk" FOREIGN KEY ("donor_id") REFERENCES "bot"."donors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot"."donor_consents" ADD CONSTRAINT "donor_consents_donor_id_donors_id_fk" FOREIGN KEY ("donor_id") REFERENCES "bot"."donors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot"."donor_phones" ADD CONSTRAINT "donor_phones_donor_id_donors_id_fk" FOREIGN KEY ("donor_id") REFERENCES "bot"."donors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot"."donor_requests" ADD CONSTRAINT "donor_requests_bot_request_id_bot_requests_id_fk" FOREIGN KEY ("bot_request_id") REFERENCES "bot"."bot_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot"."donor_requests" ADD CONSTRAINT "donor_requests_donor_id_donors_id_fk" FOREIGN KEY ("donor_id") REFERENCES "bot"."donors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot"."donor_screening_answers" ADD CONSTRAINT "donor_screening_answers_donor_id_donors_id_fk" FOREIGN KEY ("donor_id") REFERENCES "bot"."donors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot"."donors" ADD CONSTRAINT "donors_district_id_location_nodes_id_fk" FOREIGN KEY ("district_id") REFERENCES "reference"."location_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot"."donors" ADD CONSTRAINT "donors_city_id_location_nodes_id_fk" FOREIGN KEY ("city_id") REFERENCES "reference"."location_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot"."donors" ADD CONSTRAINT "donors_town_id_location_nodes_id_fk" FOREIGN KEY ("town_id") REFERENCES "reference"."location_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot"."donors" ADD CONSTRAINT "donors_locality_id_location_nodes_id_fk" FOREIGN KEY ("locality_id") REFERENCES "reference"."location_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_jobs_due_idx" ON "bot"."bot_jobs" USING btree ("status","run_at") WHERE status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "bot_requests_demand_idx" ON "bot"."bot_requests" USING btree ("demand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bot_requests_public_idx" ON "bot"."bot_requests" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "bot_requests_wave_idx" ON "bot"."bot_requests" USING btree ("status","next_wave_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_state_identity_idx" ON "bot"."conversation_state" USING btree ("channel","channel_user_id");--> statement-breakpoint
CREATE INDEX "conversation_state_expiry_idx" ON "bot"."conversation_state" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "donor_channels_identity_idx" ON "bot"."donor_channels" USING btree ("channel","channel_user_id");--> statement-breakpoint
CREATE INDEX "donor_consents_donor_idx" ON "bot"."donor_consents" USING btree ("donor_id","consented_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "donor_phones_verified_idx" ON "bot"."donor_phones" USING btree ("e164") WHERE verified;--> statement-breakpoint
CREATE UNIQUE INDEX "donor_requests_unique_idx" ON "bot"."donor_requests" USING btree ("bot_request_id","donor_id");--> statement-breakpoint
CREATE INDEX "donor_requests_status_idx" ON "bot"."donor_requests" USING btree ("bot_request_id","status");--> statement-breakpoint
CREATE INDEX "donor_requests_donor_idx" ON "bot"."donor_requests" USING btree ("donor_id");--> statement-breakpoint
CREATE INDEX "donors_wave_idx" ON "bot"."donors" USING btree ("blood_group","next_eligible_on");--> statement-breakpoint
CREATE INDEX "donors_locality_idx" ON "bot"."donors" USING btree ("locality_id");--> statement-breakpoint
CREATE INDEX "donors_district_idx" ON "bot"."donors" USING btree ("district_id");--> statement-breakpoint
CREATE INDEX "event_log_subject_idx" ON "bot"."event_log" USING btree ("subject_type","subject_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "event_log_correlation_idx" ON "bot"."event_log" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_outbox_dedupe_idx" ON "bot"."message_outbox" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "message_outbox_pending_idx" ON "bot"."message_outbox" USING btree ("status","next_attempt_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "message_outbox_kind_idx" ON "bot"."message_outbox" USING btree ("kind","status","created_at");