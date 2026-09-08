-- `updated_at` triggers for the account-lifecycle tables (§5.2).
--
-- The table privileges themselves come from the default privileges established
-- in migration 0004, so `app_web` already holds SELECT/INSERT/UPDATE/DELETE on
-- everything created here. What that default does not cover is the trigger, so
-- each new table gets one explicitly.
--
-- `object_refs` and `email_deliveries` are written by both the web app and the
-- worker, which run the same image under the same role (§1), so no additional
-- grant is required for the drain.
--
-- Rollback plan: triggers only. Dropping them leaves `updated_at` stale but
-- loses no data.

CREATE TRIGGER account_invites_set_updated_at
  BEFORE UPDATE ON "hospital"."account_invites"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER password_reset_otps_set_updated_at
  BEFORE UPDATE ON "hospital"."password_reset_otps"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER email_change_requests_set_updated_at
  BEFORE UPDATE ON "hospital"."email_change_requests"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER object_refs_set_updated_at
  BEFORE UPDATE ON "hospital"."object_refs"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER user_seals_set_updated_at
  BEFORE UPDATE ON "hospital"."user_seals"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER email_deliveries_set_updated_at
  BEFORE UPDATE ON "hospital"."email_deliveries"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
