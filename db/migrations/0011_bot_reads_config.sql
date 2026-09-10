-- The bot reads the same clinical configuration the web app does (§12).
--
-- §12 is explicit that the SQL wave query and the TypeScript predicate must take
-- their thresholds from the same place, so that a revised inter-donation
-- interval cannot move one and not the other. Those two readings live in
-- different processes, on different roles, so the bot needs to see the rows.
--
-- SELECT only, and only on `app_config`. The bot cannot change a clinical
-- threshold: shortening an interval is the one edit in this system that could
-- physically harm somebody, and it belongs to the screen that audits it.
--
-- Rollback plan: a single grant. No data is touched.

GRANT SELECT ON "hospital"."app_config" TO app_bot;
