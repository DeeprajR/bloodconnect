CREATE TABLE "hospital"."admissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ip_no" text NOT NULL,
	"patient_id" uuid NOT NULL,
	"ward" text NOT NULL,
	"admitted_at" timestamp with time zone NOT NULL,
	"discharged_at" timestamp with time zone,
	"status" text DEFAULT 'admitted' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admissions_status_check" CHECK (status IN ('admitted', 'discharged')),
	CONSTRAINT "admissions_discharge_check" CHECK (discharged_at IS NULL OR discharged_at >= admitted_at),
	CONSTRAINT "admissions_status_consistency" CHECK ((status = 'discharged') = (discharged_at IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "hospital"."blood_request_counters" (
	"year" integer PRIMARY KEY NOT NULL,
	"next_value" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hospital"."blood_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" text,
	"centre_id" uuid NOT NULL,
	"admission_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"indication" text,
	"date_required" date,
	"blood_group" text,
	"product" text,
	"units" integer,
	"submitted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"patient_snapshot" jsonb,
	"doctor_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blood_requests_status_check" CHECK (status IN ('draft', 'submitted', 'approved', 'partially_approved', 'declined', 'cancelled')),
	CONSTRAINT "blood_requests_submitted_check" CHECK (status = 'draft' OR (
        request_id IS NOT NULL
        AND patient_snapshot IS NOT NULL
        AND doctor_snapshot IS NOT NULL
        AND submitted_at IS NOT NULL
        AND indication IS NOT NULL
        AND date_required IS NOT NULL
        AND blood_group IS NOT NULL
        AND product IS NOT NULL
        AND units IS NOT NULL
      )),
	CONSTRAINT "blood_requests_units_check" CHECK (units IS NULL OR units >= 1),
	CONSTRAINT "blood_requests_blood_group_check" CHECK (blood_group IS NULL OR blood_group IN ('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+')),
	CONSTRAINT "blood_requests_product_check" CHECK (product IS NULL OR product IN ('whole_blood', 'prbc', 'platelet_concentrate', 'ffp', 'cryoprecipitate')),
	CONSTRAINT "blood_requests_cancel_check" CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "hospital"."centres" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hospital"."patients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"dob" date,
	"age" integer,
	"age_unit" text,
	"sex" text NOT NULL,
	"blood_group" text NOT NULL,
	"uhid" text,
	"attender_name" text,
	"attender_phone" text,
	"address" text,
	"district_id" text,
	"city_id" text,
	"diagnosis" text,
	"history" text,
	"previous_transfusion" text DEFAULT 'unknown' NOT NULL,
	"previous_reaction" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patients_age_check" CHECK (dob IS NOT NULL OR (age IS NOT NULL AND age_unit IS NOT NULL)),
	CONSTRAINT "patients_age_unit_check" CHECK (age_unit IS NULL OR age_unit IN ('days', 'months', 'years')),
	CONSTRAINT "patients_age_nonneg_check" CHECK (age IS NULL OR age >= 0),
	CONSTRAINT "patients_sex_check" CHECK (sex IN ('female', 'male', 'other')),
	CONSTRAINT "patients_blood_group_check" CHECK (blood_group IN ('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+')),
	CONSTRAINT "patients_previous_transfusion_check" CHECK (previous_transfusion IN ('yes', 'no', 'unknown')),
	CONSTRAINT "patients_reaction_check" CHECK (previous_reaction IS NULL OR previous_transfusion = 'yes')
);
--> statement-breakpoint
ALTER TABLE "hospital"."admissions" ADD CONSTRAINT "admissions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "hospital"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."admissions" ADD CONSTRAINT "admissions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "hospital"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."blood_requests" ADD CONSTRAINT "blood_requests_centre_id_centres_id_fk" FOREIGN KEY ("centre_id") REFERENCES "hospital"."centres"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."blood_requests" ADD CONSTRAINT "blood_requests_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "hospital"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."blood_requests" ADD CONSTRAINT "blood_requests_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "hospital"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."patients" ADD CONSTRAINT "patients_district_id_location_nodes_id_fk" FOREIGN KEY ("district_id") REFERENCES "reference"."location_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."patients" ADD CONSTRAINT "patients_city_id_location_nodes_id_fk" FOREIGN KEY ("city_id") REFERENCES "reference"."location_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."patients" ADD CONSTRAINT "patients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "hospital"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admissions_ip_no_idx" ON "hospital"."admissions" USING btree ("ip_no");--> statement-breakpoint
CREATE INDEX "admissions_patient_idx" ON "hospital"."admissions" USING btree ("patient_id","admitted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "blood_requests_request_id_idx" ON "hospital"."blood_requests" USING btree ("request_id") WHERE request_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "blood_requests_queue_idx" ON "hospital"."blood_requests" USING btree ("status","date_required");--> statement-breakpoint
CREATE INDEX "blood_requests_doctor_idx" ON "hospital"."blood_requests" USING btree ("doctor_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "blood_requests_admission_idx" ON "hospital"."blood_requests" USING btree ("admission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_uhid_idx" ON "hospital"."patients" USING btree ("uhid") WHERE uhid IS NOT NULL;--> statement-breakpoint
CREATE INDEX "patients_created_idx" ON "hospital"."patients" USING btree ("created_at");