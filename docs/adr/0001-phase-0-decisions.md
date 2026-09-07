# ADR 0001 — Decisions taken while building Phase 0

Date: 2026-09-08 · Status: accepted

§11.8 asks for a decisions log, and the build plan notes that solo work is where the reasoning is
most likely to exist only in one head. These are the choices Phase 0 made that the architecture
plan left open, together with the ones that extend it. Each is cheap to revisit now and expensive
to unpick later.

---

## 1. Open questions answered before Phase 0

| # | Question | Answer | Consequence |
|---|---|---|---|
| 5 | Hosting region and cross-border position (§12.4) | **Kerala, India** — `ap-south-1` in `DEPLOY_REGION` | Chosen before there was data to migrate, as §19.3 requires. Nothing in the stack assumes it; the value is configuration |
| 9 | Source and licence of the seeded location hierarchy (§5) | **Kozhikode district**, hand-compiled from lsgkerala.gov.in listings, seeded as dataset version `kerala-kozhikode-2026-09-08` | One district, four taluks, 77 local bodies, 6 corporation zones — 88 nodes. Enough for wave ordering to visibly prefer the nearest tier |
| 7 (partial) | Which chat channel launches | **Telegram** for the demonstration, behind the channel port (§2.11) | Long-polling, so no public URL and no webhook. The WhatsApp question stays open for Phase 5 |

**One district, not two or three.** The build plan asks for "two or three districts, fully
populated down to locality". Kozhikode alone gives four proximity tiers — locality, local body,
taluk, district — which is what the wave ordering demonstrates. A second district would only
demonstrate that donors in Kannur are not sent to Kozhikode, which the ordering already makes
obvious. Adding one later is a seed file, not a change.

---

## 2. The location hierarchy maps Kerala's vocabulary onto the spec's four levels

§5.8 fixes the levels as `district` / `city` / `town` / `locality`. Kerala's administrative
hierarchy is district → taluk → local self-government body → (for corporations) zone.

**Decision.** Keep §5.8's `level` values, and record the real term in a second column, `kind`:

| Level (§5.8) | Kind | Example |
|---|---|---|
| `district` | `district` | Kozhikode |
| `city` | `taluk` | Thamarassery |
| `town` | `corporation` / `municipality` / `grama_panchayat` | Feroke (municipality) |
| `locality` | `zone` | Medical College / Chevayur / Kovoor |

**Why.** The wave query in §7.7 orders on the four level columns, so changing the level names
would change the contract between the donor profile and the ordering. But a type-ahead that
labels Thamarassery a "city" and Feroke a "town" is wrong in a way a Kerala donor notices
immediately. Recording both costs one text column and a CHECK constraint.

**Consequence.** Most donors have no `locality`: only the corporation has zones. The ordering's
`CASE` already handles that — a donor with no locality simply matches at the town tier first.

**Note on the source data.** The dataset itself flags that a few panchayats sit on taluk
boundaries (Unnikulam, Atholi, Karassery) and should be verified against lsgkerala.gov.in before
production use. Corporation zones are informal groupings for donor proximity, not ward divisions,
and are expected to be re-cut to match the hospitals actually served.

---

## 3. The inter-donation interval for donors who record their sex as `other`

§5 gives the national guideline values: 90 days for men, 120 for women. The guideline does not
address a third option, and the donor onboarding offers Female · Male · Other (input-fields §4).

**Decision.** Apply **120 days** — the longer of the two — as the default, configurable under
`donor.interval_days.other` like the other two.

**Why.** Every alternative is worse. Refusing to record `other` is not acceptable. Asking a
follow-up question to determine which interval applies makes the donor justify themselves to a
chat bot. Applying the shorter interval risks recalling someone too soon, which is a clinical
harm; applying the longer one costs an occasional missed donation, which is not.

**Consequence.** It is a configuration row, so a centre with clinical advice to the contrary
changes it without a deploy. It should go in front of the centre alongside open question #1.

---

## 4. Local Postgres runs on port 5433

**Decision.** `docker-compose.yml` publishes Postgres on **5433**, not 5432.

**Why.** A natively installed PostgreSQL commonly holds 5432 — one did on the first machine this
was set up on. The failure is not loud: the application connects successfully to the wrong
server and reports an authentication or missing-relation error that reads like a bug in the
migrations. Moving the container removes the ambiguity entirely.

**Consequence.** `.env.example` and CI differ: CI uses a service container on 5432, where nothing
else is listening.

---

## 5. Roles are provisioned outside the migrations

**Decision.** `db/docker/init.sql` creates `migrator`, `app_web` and `app_bot` and the test
database. `db/migrations` owns schemas, tables, indexes and grants, and creates no role.

**Why.** Roles are cluster-wide, not database objects, and production provisions them through
whatever manages the cluster — a migration that issues `CREATE ROLE` either needs superuser in
production or silently no-ops. Grants, by contrast, belong with the tables they protect and must
travel with them.

**Consequence.** CI runs `init.sql` explicitly before migrating. A new environment needs the same
two steps, which the README states.

**One wrinkle worth recording.** PostgreSQL 15 revoked `CREATE` on `public` from everyone but the
owner, and the shared `set_updated_at()` trigger function lives there — one function for every
schema rather than a copy per schema. So `init.sql` grants the migrator `CREATE, USAGE ON SCHEMA
public`, in both the main and the test database.

---

## 6. The clock's type lives in `packages/domain`

**Decision.** `Clock` is declared in `packages/domain/src/time.ts`, beside `Instant` and
`CalendarDay`. No function in the domain calls it.

**Why.** The spec's package list (§2) has six packages and no `ports` package, so the type has to
live in one of them. It belongs with the other time types. The rule the domain actually obeys is
not "knows nothing about a clock" but "no rule reads one" — a domain function that needs *now*
takes `now: Instant` as a parameter (§11.4). There is deliberately no `systemClock` export
anywhere in `packages/*`: a process that reads the wall clock is an adapter and owns its own.

---

## 7. Not decided here

Deliberately left open, and each named where it is needed:

- The component catalogue and shelf lives (§19.3 #1, #2) — Phase 3. `packages/domain` uses the
  spec's five standard names, and the shelf lives live in `product_shelf_lives`, which is a row.
- Vision shelving: one region per group or a printed marker (#8) — before any camera is ordered.
- Retention periods, consent wording, paediatric consent (#3, #4, #6) — counsel, Phases 1–9.
- Promotion criteria for taking vision out of shadow mode (#10) — Phase 8. The default is shadow
  mode on, and it stays on without evidence.
