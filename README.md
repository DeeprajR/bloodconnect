# Blood Connect

A blood request and donor recruitment system for a medical-college hospital: doctors raise
requests, the blood centre answers them from stock, and a chat bot recruits donors for whatever
the shelf could not cover, then tells everyone how it ended, including when it ends badly.

**Everything here runs on synthetic data.** No real donor, patient or staff record enters this
system at any point. That is a property of the build, not a limitation of the demonstration.

> **Not a medical device.** This software does not make clinical decisions. Blood-group
> compatibility, donor eligibility and screening answers are screening aids only; the
> pre-donation assessment and the pre-transfusion compatibility test always happen on site.

## The documents

| Document | What it says |
|---|---|
| [blood-connect-spec.md](docs/blood-connect-spec.md) | The system's behaviour: the source of truth |
| [modules-spec.md](docs/modules-spec.md) | The four modules, flow by flow |
| [input-fields.md](docs/input-fields.md) | Every screen that accepts input, and every field on it |
| [backend-architecture.md](docs/backend-architecture.md) | How it is built: processes, schema, transactions, ports |
| [build-plan.md](docs/build-plan.md) | In what order, and by when |
| [qa-test-plan.md](docs/qa-test-plan.md) | Manual test protocol: every flow, and how it is most likely to break |
| [docs/adr/](docs/adr/) | Decisions taken along the way, and why |

Section references written as §n point at the specification.

## Where the build is

**Milestone C reached. The loop in §1 closes, and the system is demonstrable.**

```
P0  Foundations                  ✅
P1  Identity and access, thin    ✅
P2  The request, thin            ✅
P3  The centre decision, thin    ✅
P4  The bot loop, thin           ✅  ▲ Milestone A, the loop closes
P5  Module 1 depth               ✅
P6  Centre depth, collisions    ✅
P7  Bot depth, the interview    ✅
P7b The request slip             ✅  (ADR 0010)
P8  Endings sweep                ✅  ▲ Milestone B (ADR 0011, ADR 0012)
P9  Volunteer + public board     ✅  (ADR 0013)
P10 Control panel                ✅  (ADR 0014)
P11 Tag reader integration       ⏸  gated on hardware
P12 Vision, shadow mode          ⏸  gated on hardware
P13 Demo readiness               ✅  ▲ Milestone C
```

Both applications' UX4G-based UI has also since been replaced by an in-repo
kit, `@blood-connect/ui`, shared by `apps/web` and `apps/admin` on two
accent colours (ADR 0015).

A doctor raises a request; the centre answers it from the shelf and whatever stock cannot cover
becomes demand **in the same transaction**; the bot recruits the nearest eligible donors; one is
screened and confirmed; the counter records the donation; the donor is thanked with a
next-eligible date, and everyone still holding a place is stood down. Every step of that is
proven against real Postgres across both database roles.

**P0** delivered the workspace and its strict TypeScript settings; the import boundary and a CI
job that proves it rejects a deep import; Docker Compose with Postgres, Mailpit and MinIO; three
schemas, three roles and the grants of §5.1; Drizzle with the first migrations and a seed runner;
the six shared packages; and the Kozhikode location hierarchy, seeded and versioned.

**P1+** delivered the two applications and the shared platform package: `users`, `sessions`,
`auth_rate_limits`, `audit_log` and `app_config`; Argon2id passwords and an httpOnly session
cookie storing only a hash; login throttling per IP and per account, in the database; the three
authorization layers of §13 reading one decision function; the audit writer wired into the
use-case context; and a seeded account for each of the four roles. Sign in, sign out, and four
role dashboards, built on UX4G.

**Administration is a separate application** ([ADR 0003](docs/adr/0003-administration-as-a-separate-application.md)).
The staff app runs on :3000 and holds the clinical roles; administration runs on :3001 and holds
only `admin`, which can manage doctor records and nothing clinical. Sessions name the application
that issued them, so a cookie from one is inert in the other.

An administrator adds a doctor, who receives an emailed link, sets their own password and is
signed in. Doctors reset a password with a six-digit code, and change their address by confirming
it from the new inbox, no administrator approves it. Mail lands in Mailpit at
http://localhost:8025.

**P2** delivered Module 1: patients, admissions, the draft/review/submit flow, and the
transactional counter of §7.1 that gives two doctors submitting in the same millisecond
consecutive identifiers with no gap. Both snapshots are frozen at submit, so editing a patient
record later never rewrites what the centre was told. The administrator's patients-per-doctor
view is wired up, and every read of it is audited by record.

**P3** delivered Module 2: the register (`blood_bags`, `rfid_tags`, typed intake with the expiry
derived from collection), the request queue with stock on hand, and the decision transaction of
§7.2: `FOR UPDATE SKIP LOCKED` oldest-expiry-first, one decision per request enforced by a unique
constraint, and a shortfall raising demand in the same transaction. Plus the stock floor, and
"recruit for groups below floor" that cannot double-raise. ([ADR 0005](docs/adr/0005-the-centre-decision.md))

**P4** delivered Module 3 and closed the loop: the `bot` schema as its own migration set and its
own deployable, the channel port with a Telegram adapter and an in-memory one, minimal onboarding
that commits nothing until consent, wave selection by proximity (§7.7) with the mandatory
agreement test between its SQL and its TypeScript twin, the six screening questions, the last-unit
conditional UPDATE of §7.3 with waitlisting and promotion, and the outbox that makes §7.6's
stand-down guarantee real. ([ADR 0006](docs/adr/0006-the-bot-loop-and-milestone-a.md))

**Running the bot.** `pnpm bot`. With no `TELEGRAM_BOT_TOKEN` it runs on the in-memory channel and
the whole loop still works: §10 requires the system to be demonstrable when the chat platform is
unreachable, so that is a supported mode rather than a test shortcut. Put a token from @BotFather
in `.env` to talk to a real account.

**P5** closed Module 1's endings. **Cancelling a submitted request** is the one the
loop is judged on: it releases any units the centre was holding, withdraws the donor demand, and
the bot stands down every donor who had agreed to come, one transaction across three modules,
because a request showing cancelled while units stay held for it is worse than not cancelling.
Plus the duplicate-patient warning, draft ageing, and the compatibility testing sample with its
globally unique identifier. ([ADR 0007](docs/adr/0007-module-1-depth-and-a-query-that-lied.md))

**P6** built the part of the system most likely to put the wrong unit into a patient. A tag that
already exists is **three** situations, and they do not share a button: a return, a release, or a
discrepancy that offers no resolution at all and asks somebody to go and find the conflicting unit.
Returns ask how long the unit was out of storage **before** offering an outcome, and the database
refuses a restock that was out too long or for a time nobody can say. Plus quarantine that ages
visibly, discards that require a disposal route, and the counter roster.

The walk-in was the interesting one: recorded as a confirmation row it passed every test and was
refused by Postgres the moment it ran as `app_web`, because the centre holds no INSERT on the
bot's roster. It is now its own table, and the bot reads it and stops recruiting for a unit already
collected. `pnpm smoke:centre` is what found that. It runs P6's writes as the real application
role, which the test suite (connecting as `migrator`) cannot.
([ADR 0008](docs/adr/0008-centre-depth-and-a-grant-that-said-no.md))

**P7** replaced the seven fields matching needed with the interview §5 describes.
Ten steps: the platform is asked for the phone so the number arrives **verified**
and the counter has something it can ring; the date of birth as year, month, day,
because age asked directly gets rounded; "I don't know" for the blood group, since
guessing is worse; the four-level location matched against the seeded hierarchy.
Then the summary, every answer played back, numbered, the phone masked, with a
checklist that fixes three wrong answers in **one** pass and returns once. The
profile editor is the same screens with a different way in.

Erasure was the finding. §12.1 requires de-identifying the roster; `app_bot` had
no grant to do it, so deletion reported success and left the donor's name and
number on every roster row for ever. Migration 0016 grants exactly those two
columns. The unit number and the date stay, because that is the donation record.
`pnpm smoke:bot` runs the whole thing as `app_bot`, which is what caught it.
([ADR 0009](docs/adr/0009-the-interview-and-an-erasure-that-did-not-land.md))

**A change of shape.** The doctor app becomes a **request slip**: blood group,
product, units, urgency, and an ID to read aloud to the patient's bystander, who carries it
to the blood centre. Everything else about the request, the patient, the admission, the
clinical context, the crossmatch sample, is entered at the counter, because a doctor
handling several patients at once is the wrong person to be typing an address.
([ADR 0010](docs/adr/0010-the-doctor-app-becomes-a-request-slip.md))

**P8** closed every ⚠︎ ending §8's flow index named, one flow short at first: the account
update-request queue had never been built, so its own ⚠︎ ending had nowhere to close. Built in
[ADR 0012](docs/adr/0012-the-update-queue-holds-two-fields.md); recorded as reached short in
[ADR 0011](docs/adr/0011-the-endings-sweep-and-one-milestone-short.md) rather than quietly
patched over. Two endings that were genuinely missing are now built too: declining the
acknowledgement leaves a donor registered and dormant rather than nothing at all, and somebody
still holding a card for a request that has filled is told the moment it fills.

**P9** built the volunteer dashboard as `packages/volunteer`, a module whose own boundary test
reads its source and fails on the name of any table holding a patient, a doctor, a donor or a
bag: eight pressure tiles, demands behind a tile, the generated share message, and the public
board behind `flag.public_board`. ([ADR 0013](docs/adr/0013-the-volunteer-board-cannot-see-a-person.md))

**P10** built the control panel, administrator-only, in the administration app, with no
clinical function: dependency tiles that do the job rather than ping it, the silent-failure
board §11.9 names, per-surface and per-route metrics, a screen that follows one unit of blood
end to end from a correlation id, and the resolved configuration, read-only. The container-
stopping test earned its place immediately, catching a storage tile that stayed green with
MinIO stopped. ([ADR 0014](docs/adr/0014-the-control-panel-and-what-it-cannot-see.md))

**P13, demo readiness.** The seed now admits patients (`pnpm db:seed`, `SYN-PT-`/`SYN-IP-`
prefixed) so the walkthrough below starts from a stocked, populated database rather than a
patient typed in by hand first. `pnpm bot:diag` checks the bot's database connection, chat
channel and contract version without starting the ticker or the conversation loop, useful
before a demo or when the loop looks stuck. `LICENSE` and `NOTICE` (Apache-2.0, §12.7) land
here too — **the copyright holder in `NOTICE` is a placeholder**, not a confirmed legal name;
see the file itself.

### The walkthrough

The loop in §1, end to end, the thing a demo audience is actually shown:

1. Sign in as the doctor and submit a request for **4 units of PRBC, O−** → get a request
   number back, read-aloud length (`DDMMYY-NNNNN`).
2. Sign in as the blood centre and decide it from the queue: whatever is on the shelf is
   issued oldest-expiry-first: whatever is short raises donor demand **in the same
   transaction**.
3. `pnpm bot` (or leave it running) picks the demand up on its next tick; the nearest wave of
   donors is asked first, visible in the seeded donor pool's spread across localities.
4. A donor accepts, answers the six screening questions, and confirms — told the hospital and
   a time.
5. **Cancel the request**, from the doctor's own request view. Every donor who had agreed to
   come is stood down immediately, in the same transaction that releases any units the centre
   was holding. This is the step most systems of this kind get wrong, and it is worth showing
   deliberately rather than skipping to the happy path.
6. Re-raise the request, let a donor confirm again, then mark them **Donated** at the centre's
   counter. Their interval rolls forward, they are thanked with a next-eligible date, and the
   demand closes once every unit is in.

Run `pnpm bot:diag` first if any step involving the bot does not behave as expected — it says
which of the database, the chat channel or the contract version is the problem, rather than
leaving that to be guessed from the ticker's log output.

Run `pnpm db:seed` and sign in as any of:

| Role | Email | Lands on |
|---|---|---|
| Doctor | `doctor@blood-connect.invalid` | `/dashboard` |
| Blood centre | `centre@blood-connect.invalid` | `/centre` |
| Volunteer admin | `volunteer@blood-connect.invalid` | `/volunteer` |
| Administrator | `admin@blood-connect.invalid` | `/doctors` **on :3001** |

Password `BloodConnect!Demo2026`, printed by the seed. These are synthetic accounts on a
`.invalid` domain, and the seed refuses to run with `NODE_ENV=production`.

## Getting started

Needs Node 20+, pnpm and Docker.

Run these one at a time. **Do not chain them with `&&`**. Windows PowerShell 5.1, which is
what `pnpm` opens by default on Windows, does not accept it as a statement separator.

```
pnpm install
cp .env.example .env    # everything already points at the local stack
pnpm bootstrap          # Docker up, migrations, seed. The three in order
pnpm verify             # typecheck, lint, boundaries, tests
pnpm dev                # staff :3000, administration :3001
```

`pnpm bootstrap` is one command precisely so no chaining is needed. It is not called `setup`,
because that is one of pnpm's own commands and a script by that name is shadowed by the CLI,
which reconfigures your PATH instead of running the project.

There is one `.env`, at the workspace root, shared by the web app, the worker, the bot and the
seed runner: `apps/web/next.config.ts` loads it, because Next otherwise reads `.env` only from
the application directory. Two copies of a connection string are two things to keep in step.

| Service | Where |
|---|---|
| Postgres | `localhost:5433`: **not** 5432, so a natively installed server cannot be reached by accident ([ADR 0001](docs/adr/0001-phase-0-decisions.md)) |
| Mailpit inbox | http://localhost:8025 |
| MinIO console | http://localhost:9001 (`minioadmin` / `minioadmin`) |

Roles come from `db/docker/init.sql`, which Postgres runs on first start. A database that already
exists will not re-run it: `docker compose down -v` then `pnpm up` to start clean.

### Commands

| Command | Does |
|---|---|
| `pnpm verify` | Everything CI runs, in the same order |
| `pnpm typecheck` | `tsc -b`, plus the no-emit project that covers the test files |
| `pnpm lint` | ESLint, type-aware |
| `pnpm boundaries` | The import boundary of §11.2 |
| `pnpm boundaries:prove` | Writes a deliberate deep import and asserts the check rejects it |
| `pnpm check:gates` | Every page decides access (§13); every mutating use case records what it did (§14) |
| `pnpm test` | Vitest. Database suites skip without `TEST_DATABASE_URL` |
| `node scripts/make-icons.mjs` | Regenerate the PWA icons from the committed drawing |
| `pnpm clean:next` | Deletes both `.next` caches. What to run when a page that has always worked fails on navigation with an ENOENT for a `build-manifest.json`: the route is fine, the Turbopack development cache is describing a build that no longer exists. Stop the dev server first |
| `pnpm smoke:signin [url]` | Signs in against a running server the way a browser with no JavaScript would: the wiring a unit test cannot see |
| `pnpm smoke:centre` | Runs the centre's writes as `app_web` and asserts what that role must not be able to do. The suite connects as `migrator`, so it proves nothing about the grants; this does |
| `pnpm smoke:bot` | The same for `app_bot`: the interview, the profile edit, erasure, and the six things the bot must not be able to reach |
| `pnpm bot` | The donor bot: long-polls the channel and ticks. `CHANNEL=memory` needs no token |
| `pnpm bot:diag` | Checks the bot's database, chat channel and contract version and says what to do about each failure, without starting the ticker or conversation loop |
| `pnpm check:bot-migrations` | Greps the bot's migrations for a table the web release owns (§2.1) |
| `pnpm db:generate` / `pnpm db:generate:bot` | Generate a migration from the Drizzle schema, for either set |
| `pnpm db:migrate` / `pnpm db:migrate:bot` / `pnpm db:seed` | Apply either migration set / seed reference data |
| `pnpm db:push` | Refused unless the target database is named as a scratch one |

## Layout

```
packages/
  platform/   accounts, sessions, authorization, audit, email, config, shared by both apps
  hospital/   Module 1: patients, admissions, requests, and its narrow read API
  centre/     Module 2: the register, the §7.2 decision, demand and the stock floor
  bot/        Module 3: onboarding, waves, screening, the outbox and the stand-down
  domain/     the clinical rules, pure, no clock, no I/O, imported by web and bot alike
  contract/   the two shared tables: schemas, column ownership, writer-scoped transitions
  config/     clinical thresholds as data, with defaults and a 60-second cache
  result/     Result<T, E>, expected failures are values, not exceptions
  ids/        branded UUIDv7 identifiers
  testing/    fake clock, deterministic ids, the real-Postgres harness
db/
  migrations/ hospital + reference. The only creator of the shared contract tables
  migrations-bot/ the bot schema, applied by the bot release. Never mentions donor_demand
  seeds/      the location hierarchy, synthetic stock and a synthetic donor pool
  src/        Drizzle schema, migration runner, seed runner, the db:push guard
docs/         the specification set and the decision log
```

`apps/web` is the staff application, `apps/admin` is administration, and `apps/bot` is the donor
bot, three deployables on three database roles. `apps/vision` arrives with the phase that needs
it.

### The rules the build enforces mechanically

Because there is no second reader on a commit here, CI is the reviewer:

- **`packages/domain` imports nothing outside itself.** The clinical rules exist once, shared by
  the web app and the bot, so the two can never disagree about who may donate to whom (§11.3).
- **No deep imports across packages.** A package's entry point is its contract (§11.2).
- **The full 8×8 compatibility matrix is tested against a table written out by hand**, not
  derived from the implementation.
- **Migrations only.** `db:push` is refused outside a scratch database, and in CI (§5.9).
- **The grants are asserted, not reviewed.** Tests connect as `app_web` and `app_bot` and check
  what they *cannot* do.
- **Every state machine's table is checked for states with no way out**, the failure §8 exists
  to prevent.
- **Both applications are installable PWAs**, and the service worker caches the shell and
  **never** data, a cached stock figure is a wrong stock figure, and on a shared ward device a
  cached page is somebody else's page ([ADR 0004](docs/adr/0004-pwa-and-a-spacing-token-that-does-not-exist.md)).
- **§9's role matrix is a test**, transcribed row by row, asserted for every role, and the 403
  response is checked for carrying *no data*, which is the mistake §14 names.

## Licence

Apache-2.0 (§12.7). See [`LICENSE`](LICENSE) for the full text and
[`NOTICE`](NOTICE) for attribution — **the copyright holder named there is a
placeholder**, pending confirmation from whichever hospital, university or
other entity this is actually released in the name of.
