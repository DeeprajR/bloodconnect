# Inbox

- [x] ~~to the plan add the c-panel dashboard where I can see health of all APIs, metrics, to the
  granular details.~~
  → Added as **P10 · Control panel** in [docs/build-plan.md](docs/build-plan.md). Health of every
  dependency checked by doing its job rather than pinging it, §11.9's silent-failure list as a
  board, per-route metrics, and a screen that follows one unit of blood end to end by correlation
  id. Administrator-only, in the admin app, with no clinical function. The hardware phases and
  demo readiness shifted to P11–P13; Milestone C moves to day ~82.

  **Built and shipped** in `fd1fad3`, recorded in
  [ADR 0014](docs/adr/0014-the-control-panel-and-what-it-cannot-see.md). Live at `/panel` in the
  administration app, with the trace screen at `/panel/trace` and the configuration view at
  `/panel/deployment`. Two things worth knowing about it: the bot publishes its own alerts across
  the schema boundary rather than the panel reading them, because the web release holds no grant
  on the bot's schema at all; and the container-stopping test earned its place on the first run by
  catching a storage tile that stayed green with MinIO stopped.

Doctor's app:
-------------
Reduce the doctor's password length to 6 instead of 12.
Show the name and email of the signed in doctor in the top right account section.

Blood Centre:
-------------
Improve the "localhost:3000/requests/01a08b53-06f2-7540-a624-4b271a09b9d0?raised=1" page to show the UUID number with priority

Auto-refresh (while ensuring the user is retained in the same page which they are using) of "http://localhost:3000/centre" page to show live requests instead of manual refresh.

Delete the Somebody is here with an ID section from "http://localhost:3000/centre/requests" 

How emergency requirements are handled from Blood bank?

Partial information in http://localhost:3000/centre/requests/* is not being saved if user missed something

The date picker UI should be simple, by using YYYY, MM, DD slider

On clicking Roster, it shows the error: "## Error Type
Runtime Error

## Error Message
ENOENT: no such file or directory, open 'C:\Users\dr\Desktop\BloodConnect\apps\web\.next\dev\server\app\centre\demands\[id]\page\build-manifest.json'

Next.js version: 16.3.4 (Turbopack)
"

Telegram Bot:
-------------
In the bot, there is no default menu to show live blood requirement, inform interest to random donate.

Implement menu option in Telegram bot for the users to select from.

When I click Recruit for Donors below the floor, no telegram notification is received (I signed in as B+)