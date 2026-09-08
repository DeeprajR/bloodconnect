CREATE TABLE "hospital"."account_invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"sent_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hospital"."email_change_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"current_email" text NOT NULL,
	"new_email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_change_requests_distinct_check" CHECK (new_email <> current_email)
);
--> statement-breakpoint
CREATE TABLE "hospital"."email_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"to_address" text NOT NULL,
	"template_version" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_deliveries_status_check" CHECK (status IN ('queued', 'sent', 'delivered', 'bounced', 'complained', 'failed')),
	CONSTRAINT "email_deliveries_kind_check" CHECK (kind IN ('invite', 'invite_resent', 'password_otp', 'password_changed', 'email_change_confirm', 'email_change_notice', 'account_deactivated'))
);
--> statement-breakpoint
CREATE TABLE "hospital"."object_refs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bucket" text NOT NULL,
	"key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"kind" text NOT NULL,
	"owner_id" uuid,
	"delete_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_refs_kind_check" CHECK (kind IN ('seal', 'frame')),
	CONSTRAINT "object_refs_size_check" CHECK (byte_size > 0)
);
--> statement-breakpoint
CREATE TABLE "hospital"."password_reset_otps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"otp_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_otps_attempts_check" CHECK (attempts >= 0)
);
--> statement-breakpoint
CREATE TABLE "hospital"."user_seals" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"object_ref_id" uuid NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hospital"."sessions" ADD COLUMN "audience" text DEFAULT 'staff' NOT NULL;--> statement-breakpoint
ALTER TABLE "hospital"."account_invites" ADD CONSTRAINT "account_invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "hospital"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."account_invites" ADD CONSTRAINT "account_invites_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "hospital"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."email_change_requests" ADD CONSTRAINT "email_change_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "hospital"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."email_deliveries" ADD CONSTRAINT "email_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "hospital"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."object_refs" ADD CONSTRAINT "object_refs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "hospital"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."password_reset_otps" ADD CONSTRAINT "password_reset_otps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "hospital"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."user_seals" ADD CONSTRAINT "user_seals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "hospital"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."user_seals" ADD CONSTRAINT "user_seals_object_ref_id_object_refs_id_fk" FOREIGN KEY ("object_ref_id") REFERENCES "hospital"."object_refs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital"."user_seals" ADD CONSTRAINT "user_seals_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "hospital"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_invites_token_hash_idx" ON "hospital"."account_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "account_invites_one_live_idx" ON "hospital"."account_invites" USING btree ("user_id") WHERE consumed_at IS NULL AND superseded_at IS NULL;--> statement-breakpoint
CREATE INDEX "account_invites_ageing_idx" ON "hospital"."account_invites" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_change_requests_token_hash_idx" ON "hospital"."email_change_requests" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "email_change_requests_one_live_idx" ON "hospital"."email_change_requests" USING btree ("user_id") WHERE consumed_at IS NULL AND superseded_at IS NULL AND cancelled_at IS NULL;--> statement-breakpoint
CREATE INDEX "email_deliveries_drain_idx" ON "hospital"."email_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "email_deliveries_user_idx" ON "hospital"."email_deliveries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "object_refs_location_idx" ON "hospital"."object_refs" USING btree ("bucket","key");--> statement-breakpoint
CREATE INDEX "object_refs_retention_idx" ON "hospital"."object_refs" USING btree ("delete_after");--> statement-breakpoint
CREATE INDEX "object_refs_owner_idx" ON "hospital"."object_refs" USING btree ("owner_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_otps_one_live_idx" ON "hospital"."password_reset_otps" USING btree ("user_id") WHERE consumed_at IS NULL AND superseded_at IS NULL;--> statement-breakpoint
ALTER TABLE "hospital"."sessions" ADD CONSTRAINT "sessions_audience_check" CHECK (audience IN ('staff', 'admin'));