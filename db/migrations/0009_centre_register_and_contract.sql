-- Module 2: the register, the decision, and the two shared contract tables
-- (§5.5, §5.6).
--
-- Generated from the Drizzle schema, so the table definitions and the TypeScript
-- cannot disagree. The grants that narrow the two contract tables are migration
-- 0010, deliberately in their own file: a grant is the part a reviewer has to
-- read line by line, and it should not be buried under two hundred lines of
-- column definitions.
--
-- Three things here are the point of the whole phase:
--
--   * blood_bags_available_idx  -- the partial index the §7.2 claim runs on
--   * centre_decisions_request_idx -- one decision per request, enforced
--   * donor_demand_open_floor_idx  -- recruit-for-floor cannot double-raise
--
-- Rollback plan: forward-only. These are new tables with no data; reversing is
-- DROP TABLE in reverse dependency order, and nothing existing is altered.

CREATE TABLE "hospital"."blood_bags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"centre_id" uuid NOT NULL,
	"unit_number" text NOT NULL,
	"blood_group" text NOT NULL,
	"product" text NOT NULL,
	"collected_at" date NOT NULL,
	"expires_at" date NOT NULL,
	"expiry_source" text DEFAULT 'derived' NOT NULL,
	"source" text,
	"status" text DEFAULT 'available' NOT NULL,
	"reserved_for_request_id" uuid,
	"issued_to_request_id" uuid,
	"issued_at" timestamp with time zone,
	"registered_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blood_bags_expiry_check" CHECK (expires_at >= collected_at),
	CONSTRAINT "blood_bags_group_check" CHECK (blood_group IN ('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+')),
	CONSTRAINT "blood_bags_product_check" CHECK (product IN ('whole_blood', 'prbc', 'platelet_concentrate', 'ffp', 'cryoprecipitate')),
	CONSTRAINT "blood_bags_status_check" CHECK (status IN ('available', 'reserved', 'issued', 'returned', 'quarantined', 'discarded', 'expired', 'lost')),
	CONSTRAINT "blood_bags_expiry_source_check" CHECK (expiry_source IN ('derived', 'label')),
	CONSTRAINT "blood_bags_reserved_check" CHECK (status <> 'reserved' OR reserved_for_request_id IS NOT NULL),
	CONSTRAINT "blood_bags_issued_check" CHECK (status <> 'issued' OR (issued_to_request_id IS NOT NULL AND issued_at IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "hospital"."centre_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"units_issued" integer DEFAULT 0 NOT NULL,
	"units_requested" integer NOT NULL,
	"note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"demand_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "centre_decisions_decision_check" CHECK (decision IN ('approved', 'partial', 'declined')),
	CONSTRAINT "centre_decisions_units_check" CHECK (units_issued >= 0 AND units_issued <= units_requested),
	CONSTRAINT "centre_decisions_consistency_check" CHECK ((decision = 'declined' AND units_issued = 0)
       OR (decision = 'approved' AND units_issued = units_requested)
       OR (decision = 'partial' AND units_issued > 0 AND units_issued < units_requested))
);
--> statement-breakpoint
CREATE TABLE "hospital"."centre_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"centre_id" uuid NOT NULL,
	"hospital_name" text NOT NULL,
	"address" text NOT NULL,
	"district_id" text,
	"city_id" text,
	"min_units_per_group" integer DEFAULT 25 NOT NULL,
	"return_time_limit_minutes" integer DEFAULT 30 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "centre_settings_single_row" CHECK (id = 1)
);
--> statement-breakpoint
CREATE TABLE "hospital"."decision_bags" (
	"decision_id" uuid NOT NULL,
	"bag_id" uuid NOT NULL,
	CONSTRAINT "decision_bags_decision_id_bag_id_pk" PRIMARY KEY("decision_id","bag_id")
);
--> statement-breakpoint
CREATE TABLE "hospital"."donor_demand" (
	"id" uuid PRIMARY KEY NOT NULL,
	"centre_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"blood_request_id" uuid,
	"blood_group" text NOT NULL,
	"product" text NOT NULL,
	"units" integer NOT NULL,
	"date_required" date NOT NULL,
	"hospital_name" text NOT NULL,
	"hospital_address" text NOT NULL,
	"district_id" text NOT NULL,
	"city_id" text,
	"notes" text,
	"status" text DEFAULT 'open' NOT NULL,
	"bot_public_id" text,
	"imported_at" timestamp with time zone,
	"donors_notified" integer DEFAULT 0 NOT NULL,
	"confirmed_units" integer DEFAULT 0 NOT NULL,
	"waitlisted_units" integer DEFAULT 0 NOT NULL,
	"completed_units" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "donor_demand_trigger_check" CHECK (trigger IN ('request_shortfall', 'stock_floor')),
	CONSTRAINT "donor_demand_status_check" CHECK (status IN ('open', 'fulfilled', 'completed', 'cancelled', 'expired')),
	CONSTRAINT "donor_demand_group_check" CHECK (blood_group IN ('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+')),
	CONSTRAINT "donor_demand_product_check" CHECK (product IN ('whole_blood', 'prbc')),
	CONSTRAINT "donor_demand_units_check" CHECK (units >= 1),
	CONSTRAINT "donor_demand_counters_check" CHECK (donors_notified >= 0 AND confirmed_units >= 0 AND waitlisted_units >= 0 AND completed_units >= 0),
	CONSTRAINT "donor_demand_trigger_link_check" CHECK ((trigger = 'request_shortfall') = (blood_request_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "hospital"."donor_demand_confirmations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"demand_id" uuid NOT NULL,
	"donor_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"donor_name" text NOT NULL,
	"donor_phone" text NOT NULL,
	"blood_group" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"donated_at" date,
	"bag_identifier" text,
	"marked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "donor_demand_confirmations_status_check" CHECK (status IN ('confirmed', 'completed', 'no_show', 'cancelled')),
	CONSTRAINT "donor_demand_confirmations_group_check" CHECK (blood_group IN ('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+')),
	CONSTRAINT "donor_demand_confirmations_donated_check" CHECK (donated_at IS NULL OR status = 'completed')
);
--> statement-breakpoint
CREATE TABLE "hospital"."product_shelf_lives" (
	"product" text PRIMARY KEY NOT NULL,
	"shelf_life_days" integer NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_shelf_lives_product_check" CHECK (product IN ('whole_blood', 'prbc', 'platelet_concentrate', 'ffp', 'cryoprecipitate')),
	CONSTRAINT "product_shelf_lives_days_check" CHECK (shelf_life_days > 0)
);
--> statement-breakpoint
CREATE TABLE "hospital"."rfid_tags" (
	"tag_uid" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'unassigned' NOT NULL,
	"current_bag_id" uuid,
	"retired_at" timestamp with time zone,
	"retire_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rfid_tags_status_check" CHECK (status IN ('unassigned', 'assigned', 'retired')),
	CONSTRAINT "rfid_tags_assigned_check" CHECK (status <> 'assigned' OR current_bag_id IS NOT NULL),
	CONSTRAINT "rfid_tags_retired_check" CHECK (status <> 'retired' OR current_bag_id IS NULL),
	CONSTRAINT "rfid_tags_retired_at_check" CHECK ((status = 'retired') = (retired_at IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "hospital"."tag_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tag_uid" text NOT NULL,
	"bag_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" uuid,
	"released_at" timestamp with time zone,
	"released_by" uuid,
	"release_reason" text
);
--> statement-breakpoint
ALTER TABLE "hospital"."blood_bags" ADD CONSTRAINT "blood_bags_centre_id_centres_id_fk" FOREIGN KEY ("centre_id") REFERENCES "hospital"."centres"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."blood_bags" ADD CONSTRAINT "blood_bags_reserved_for_request_id_blood_requests_id_fk" FOREIGN KEY ("reserved_for_request_id") REFERENCES "hospital"."blood_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."blood_bags" ADD CONSTRAINT "blood_bags_issued_to_request_id_blood_requests_id_fk" FOREIGN KEY ("issued_to_request_id") REFERENCES "hospital"."blood_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."blood_bags" ADD CONSTRAINT "blood_bags_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "hospital"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."centre_decisions" ADD CONSTRAINT "centre_decisions_request_id_blood_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "hospital"."blood_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."centre_decisions" ADD CONSTRAINT "centre_decisions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "hospital"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."centre_settings" ADD CONSTRAINT "centre_settings_centre_id_centres_id_fk" FOREIGN KEY ("centre_id") REFERENCES "hospital"."centres"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."centre_settings" ADD CONSTRAINT "centre_settings_district_id_location_nodes_id_fk" FOREIGN KEY ("district_id") REFERENCES "reference"."location_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."centre_settings" ADD CONSTRAINT "centre_settings_city_id_location_nodes_id_fk" FOREIGN KEY ("city_id") REFERENCES "reference"."location_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."centre_settings" ADD CONSTRAINT "centre_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "hospital"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."decision_bags" ADD CONSTRAINT "decision_bags_decision_id_centre_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "hospital"."centre_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."decision_bags" ADD CONSTRAINT "decision_bags_bag_id_blood_bags_id_fk" FOREIGN KEY ("bag_id") REFERENCES "hospital"."blood_bags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."donor_demand" ADD CONSTRAINT "donor_demand_centre_id_centres_id_fk" FOREIGN KEY ("centre_id") REFERENCES "hospital"."centres"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."donor_demand" ADD CONSTRAINT "donor_demand_blood_request_id_blood_requests_id_fk" FOREIGN KEY ("blood_request_id") REFERENCES "hospital"."blood_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."donor_demand_confirmations" ADD CONSTRAINT "donor_demand_confirmations_demand_id_donor_demand_id_fk" FOREIGN KEY ("demand_id") REFERENCES "hospital"."donor_demand"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."product_shelf_lives" ADD CONSTRAINT "product_shelf_lives_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "hospital"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."rfid_tags" ADD CONSTRAINT "rfid_tags_current_bag_id_blood_bags_id_fk" FOREIGN KEY ("current_bag_id") REFERENCES "hospital"."blood_bags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."tag_assignments" ADD CONSTRAINT "tag_assignments_tag_uid_rfid_tags_tag_uid_fk" FOREIGN KEY ("tag_uid") REFERENCES "hospital"."rfid_tags"("tag_uid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."tag_assignments" ADD CONSTRAINT "tag_assignments_bag_id_blood_bags_id_fk" FOREIGN KEY ("bag_id") REFERENCES "hospital"."blood_bags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."tag_assignments" ADD CONSTRAINT "tag_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "hospital"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."tag_assignments" ADD CONSTRAINT "tag_assignments_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "hospital"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "blood_bags_unit_number_idx" ON "hospital"."blood_bags" USING btree ("unit_number");--> statement-breakpoint
CREATE INDEX "blood_bags_available_idx" ON "hospital"."blood_bags" USING btree ("blood_group","product","expires_at") WHERE status = 'available';--> statement-breakpoint
CREATE INDEX "blood_bags_status_idx" ON "hospital"."blood_bags" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "centre_decisions_request_idx" ON "hospital"."centre_decisions" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_bags_bag_idx" ON "hospital"."decision_bags" USING btree ("bag_id");--> statement-breakpoint
CREATE INDEX "donor_demand_awaiting_import_idx" ON "hospital"."donor_demand" USING btree ("status","bot_public_id") WHERE status = 'open' AND bot_public_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "donor_demand_open_floor_idx" ON "hospital"."donor_demand" USING btree ("centre_id","blood_group") WHERE trigger = 'stock_floor' AND status = 'open';--> statement-breakpoint
CREATE INDEX "donor_demand_status_idx" ON "hospital"."donor_demand" USING btree ("status","date_required");--> statement-breakpoint
CREATE UNIQUE INDEX "donor_demand_confirmations_donor_idx" ON "hospital"."donor_demand_confirmations" USING btree ("demand_id","donor_id");--> statement-breakpoint
CREATE INDEX "donor_demand_confirmations_status_idx" ON "hospital"."donor_demand_confirmations" USING btree ("demand_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_assignments_live_tag_idx" ON "hospital"."tag_assignments" USING btree ("tag_uid") WHERE released_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tag_assignments_live_bag_idx" ON "hospital"."tag_assignments" USING btree ("bag_id") WHERE released_at IS NULL;--> statement-breakpoint
CREATE INDEX "tag_assignments_bag_idx" ON "hospital"."tag_assignments" USING btree ("bag_id","assigned_at" DESC NULLS LAST);