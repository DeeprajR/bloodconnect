CREATE SCHEMA "hospital";
--> statement-breakpoint
CREATE TABLE "hospital"."app_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hospital"."audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_kind" text NOT NULL,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"correlation_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "audit_log_actor_kind_check" CHECK (actor_kind IN ('user', 'device', 'system', 'bot')),
	CONSTRAINT "audit_log_actor_check" CHECK ((actor_kind = 'user') = (actor_user_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "hospital"."auth_rate_limits" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_rate_limits_scope_check" CHECK (scope IN ('login_ip', 'login_account', 'otp_ip', 'otp_account'))
);
--> statement-breakpoint
CREATE TABLE "hospital"."sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hospital"."users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" "citext" NOT NULL,
	"full_name" text NOT NULL,
	"role" text NOT NULL,
	"provisional_reg" text,
	"district_scope_id" text,
	"status" text DEFAULT 'pending_activation' NOT NULL,
	"password_hash" text,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_role_check" CHECK (role IN ('doctor', 'admin', 'blood_centre', 'volunteer_admin')),
	CONSTRAINT "users_status_check" CHECK (status IN ('pending_activation', 'active', 'deactivated')),
	CONSTRAINT "users_activation_check" CHECK ((status = 'pending_activation') = (password_hash IS NULL)),
	CONSTRAINT "users_district_scope_check" CHECK (district_scope_id IS NULL OR role = 'volunteer_admin')
);
--> statement-breakpoint
ALTER TABLE "hospital"."app_config" ADD CONSTRAINT "app_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "hospital"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "hospital"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "hospital"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."users" ADD CONSTRAINT "users_district_scope_id_location_nodes_id_fk" FOREIGN KEY ("district_scope_id") REFERENCES "reference"."location_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_subject_idx" ON "hospital"."audit_log" USING btree ("subject_type","subject_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_correlation_idx" ON "hospital"."audit_log" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_rate_limits_window_idx" ON "hospital"."auth_rate_limits" USING btree ("scope","key","window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_idx" ON "hospital"."sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_live_by_user_idx" ON "hospital"."sessions" USING btree ("user_id") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "hospital"."users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_provisional_reg_idx" ON "hospital"."users" USING btree ("provisional_reg") WHERE provisional_reg IS NOT NULL;--> statement-breakpoint
CREATE INDEX "users_role_status_idx" ON "hospital"."users" USING btree ("role","status");