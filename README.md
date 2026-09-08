# Blood Connect

A blood request and donor recruitment system for a medical-college hospital: doctors raise
requests, the blood centre answers them from stock, and a chat bot recruits donors for whatever
the shelf could not cover — then tells everyone how it ended, including when it ends badly.

**Everything here runs on synthetic data.** No real donor, patient or staff record enters this
system at any point. That is a property of the build, not a limitation of the demonstration.

> **Not a medical device.** This software does not make clinical decisions. Blood-group
> compatibility, donor eligibility and screening answers are screening aids only; the
> pre-donation assessment and the pre-transfusion compatibility test always happen on site.

## The documents

| Document | What it says |
|---|---|
| [blood-connect-spec.md](docs/blood-connect-spec.md) | The system's behaviour — the source of truth |
| [modules-spec.md](docs/modules-spec.md) | The four modules, flow by flow |
| [input-fields.md](docs/input-fields.md) | Every screen that accepts input, and every field on it |
| [backend-architecture.md](docs/backend-architecture.md) | How it is built: processes, schema, transactions, ports |
| [build-plan.md](docs/build-plan.md) | In what order, and by when |
| [docs/adr/](docs/adr/) | Decisions taken along the way, and why |

Section references written as §n point at the specification.

## Where the build is

**Phase 1 — identity and access. Complete.**

```
P0  Foundations                  ✅
P1  Identity and access, thin    ✅
P2  The request, thin            ← next
P3  The centre decision, thin
P4  The bot loop, thin              ▲ Milestone A — the loop closes
…
```

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
it from the new inbox — no administrator approves it. Mail lands in Mailpit at
http://localhost:8025.

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

Run these one at a time. **Do not chain them with `&&`** — Windows PowerShell 5.1, which is
what `pnpm` opens by default on Windows, does not accept it as a statement separator.

```
pnpm install
cp .env.example .env    # everything already points at the local stack
pnpm bootstrap          # Docker up, migrations, seed — the three in order
pnpm verify             # typecheck, lint, boundaries, tests
pnpm dev                # staff :3000, administration :3001
```

`pnpm bootstrap` is one command precisely so no chaining is needed. It is not called `setup`,
because that is one of pnpm's own commands and a script by that name is shadowed by the CLI —
which reconfigures your PATH instead of running the project.

There is one `.env`, at the workspace root, shared by the web app, the worker, the bot and the
seed runner — `apps/web/next.config.ts` loads it, because Next otherwise reads `.env` only from
the application directory. Two copies of a connection string are two things to keep in step.

| Service | Where |
|---|---|
| Postgres | `localhost:5433` — **not** 5432, so a natively installed server cannot be reached by accident ([ADR 0001](docs/adr/0001-phase-0-decisions.md)) |
| Mailpit inbox | http://localhost:8025 |
| MinIO console | http://localhost:9001 (`minioadmin` / `minioadmin`) |

Roles come from `db/docker/init.sql`, which Postgres runs on first start. A database that already
exists will not re-run it — `docker compose down -v` then `pnpm up` to start clean.

### Commands

| Command | Does |
|---|---|
| `pnpm verify` | Everything CI runs, in the same order |
| `pnpm typecheck` | `tsc -b`, plus the no-emit project that covers the test files |
| `pnpm lint` | ESLint, type-aware |
| `pnpm boundaries` | The import boundary of §11.2 |
| `pnpm boundaries:prove` | Writes a deliberate deep import and asserts the check rejects it |
| `pnpm test` | Vitest. Database suites skip without `TEST_DATABASE_URL` |
| `pnpm smoke:signin [url]` | Signs in against a running server the way a browser with no JavaScript would — the wiring a unit test cannot see |
| `pnpm db:generate` | Generate a migration from the Drizzle schema |
| `pnpm db:migrate` / `pnpm db:seed` | Apply migrations / seed reference data |
| `pnpm db:push` | Refused unless the target database is named as a scratch one |

## Layout

```
packages/
  platform/   accounts, sessions, authorization, audit, email, config — shared by both apps
  domain/     the clinical rules — pure, no clock, no I/O, imported by web and bot alike
  contract/   the two shared tables: schemas, column ownership, writer-scoped transitions
  config/     clinical thresholds as data, with defaults and a 60-second cache
  result/     Result<T, E> — expected failures are values, not exceptions
  ids/        branded UUIDv7 identifiers
  testing/    fake clock, deterministic ids, the real-Postgres harness
db/
  migrations/ hospital + reference. The only creator of the shared contract tables
  seeds/      the location hierarchy
  src/        Drizzle schema, migration runner, seed runner, the db:push guard
docs/         the specification set and the decision log
```

`apps/web` is the staff application and `apps/admin` is administration. `apps/bot` and
`apps/vision` arrive with the phases that need them.

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
- **Every state machine's table is checked for states with no way out** — the failure §8 exists
  to prevent.
- **§9's role matrix is a test**, transcribed row by row, asserted for every role — and the 403
  response is checked for carrying *no data*, which is the mistake §14 names.

## Licence

Apache-2.0 (§12.7). The `LICENSE` and `NOTICE` files land in P12 with the rest of the
demonstration packaging.
