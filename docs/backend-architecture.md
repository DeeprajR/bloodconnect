# Blood Connect — backend architecture plan

How the backend of the four modules is built: the deployable units, the code
boundaries, the database, the transactions that decide correctness, the machine
interfaces, the background work, and the order it gets built in.

**Source of truth.** This plan implements [modules-spec.md](modules-spec.md) (behaviour) and
[input-fields.md](input-fields.md) (fields). Section references written as §n point at the
spec. Where this plan makes a choice the spec left open, or deviates from it, that is stated
explicitly in [§19](#19-decisions-taken-deviations-and-open-questions) — nothing is changed
silently, per §11.8.

**Scope.** Backend only: process topology, packages, schema, transactions, APIs, jobs,
adapters, security, testing, and phasing. It does not decide screen layout, component
structure, or design tokens; the frontend follows the design system in `.claude/skills` and
§10 of the spec.

**Status of `web-app.md`.** That document described an earlier implementation and has been
removed: the build is greenfield, nothing is ported, and its divergences — the role called
`blood_bank` rather than `blood_centre`, a PolyForm licence rather than Apache-2.0 (§12.7), and
seals on local disk rather than in object storage (§3) — never enter this codebase. §18's
reference to reusing it as a Phase 1 baseline is superseded by
[build-plan.md](build-plan.md), which sequences the work from an empty repository.

## Contents

| | Section | What it covers |
|---|---|---|
| 1 | [Deployable units and topology](#1-deployable-units-and-topology) | Four processes, what talks to what |
| 2 | [Repository and package layout](#2-repository-and-package-layout) | Monorepo, workspaces, module ownership |
| 3 | [Layering and the dependency rule](#3-layering-and-the-dependency-rule) | Domain / application / adapters, enforced |
| 4 | [Stack decisions](#4-stack-decisions) | What is fixed, what is chosen here, why |
| 5 | [Data architecture](#5-data-architecture) | Schemas, grants, table inventory, keys, indexes |
| 6 | [The shared contract](#6-the-shared-contract) | The two tables as a versioned package |
| 7 | [Transactions and concurrency](#7-transactions-and-concurrency) | The seven places correctness is decided |
| 8 | [Application layer — use case inventory](#8-application-layer--use-case-inventory) | Every transaction boundary, by module |
| 9 | [API surfaces](#9-api-surfaces) | Browser, machine, public, and the signed centre API |
| 10 | [Ports and adapters](#10-ports-and-adapters) | Every external dependency and its failure story |
| 11 | [Background work](#11-background-work) | The runner, the ticker, the outbox, the job inventory |
| 12 | [Configuration](#12-configuration) | Clinical thresholds as data, not constants |
| 13 | [Security and authorization](#13-security-and-authorization) | Sessions, three-layer authz, device tokens, HMAC |
| 14 | [Observability, audit and errors](#14-observability-audit-and-errors) | Correlation, audit writes, the error model |
| 15 | [Compliance components](#15-compliance-components) | Retention jobs, DSR handling, notice versions, RoP |
| 16 | [Failure and degradation](#16-failure-and-degradation) | What breaks when each dependency is down |
| 17 | [Testing and CI](#17-testing-and-ci) | The test pyramid this shape makes possible |
| 18 | [Delivery plan](#18-delivery-plan) | Phases, and what each has to prove |
| 19 | [Decisions, deviations and open questions](#19-decisions-taken-deviations-and-open-questions) | ADR backlog and spec deltas |

---

## 1. Deployable units and topology

Four processes. Two of them are the spec's two deployable pieces (§1); the other two exist
because a stateless horizontally-scaled web app cannot own a schedule, and because vision
inference is Python.

```
   ┌───────────────────────────────────────────────────────────────────────┐
   │                     PostgreSQL (single instance)                      │
   │   schema hospital   ·   schema bot   ·   schema reference             │
   │   role app_web (rw hospital)  ·  role app_bot (rw bot, contract-only  │
   │   column grants on hospital.donor_demand*)  ·  role migrator          │
   └───────▲──────────────▲───────────────────────▲────────────────────────┘
           │              │                       │
   ┌───────┴───────┐ ┌────┴─────────┐  ┌──────────┴─────────┐
   │ A. web        │ │ B. worker    │  │ C. bot             │
   │ Next.js       │ │ same image   │  │ long-running       │
   │ stateless, N  │ │ as web,      │  │ single instance    │
   │ replicas      │ │ single       │  │ (advisory lock per │
   │ Modules 1,2,4 │ │ instance     │  │  bot token)        │
   │ + machine API │ │ scheduler +  │  │ Module 3           │
   └───▲───────▲───┘ │ outbox drain │  └────────┬───────────┘
       │       │     └──────────────┘           │
       │       │                                │
   browser   ┌─┴──────────────┐          ┌──────┴────────┐
   (staff)   │ D. vision svc  │          │ chat platform │
             │ Python FastAPI │          │ Telegram now, │
             │ no DB access   │          │ WhatsApp next │
             │ camera → HTTP  │          └───────────────┘
             └────────────────┘
```

| | Unit | Runtime | Scale | Public surface | Owns |
|---|---|---|---|---|---|
| **A** | `web` | Node, Next.js App Router | N replicas, stateless | HTTPS: staff UI, machine API, public board | `hospital` + `reference` schemas |
| **B** | `worker` | Node, same image as A | Exactly one | none | nothing; runs A's jobs |
| **C** | `bot` | Node | Exactly one per bot token | none on a long-polling channel; an HTTPS webhook endpoint on a webhook channel (§10) | `bot` schema |
| **D** | `vision` | Python, FastAPI | One per site or per camera | none inbound from the internet; reachable by cameras on the local network | nothing; stateless inference |

**Why `worker` is separate from `web`.** The spec calls the web app stateless and horizontally
scalable (§10). A stateless replica must not run `setInterval`: with three replicas every
scheduled sweep fires three times, and the quarantine-ageing escalation mails three times. The
worker is the same image with a different entrypoint, so it shares the use-case layer verbatim
and adds no new codebase — it is a process count, not a component. It takes a Postgres advisory
lock at boot so a rolling deploy never runs two.

**Why `vision` never touches the database.** §2.12 makes the camera observational. A process
with no database credentials cannot write the register even by mistake — the trust model is
enforced by the absence of a connection string, not by a code review. It posts observations to
`web`'s device API and reads its configuration back from the same place.

**What talks to what.** `web` → Postgres, object storage, email provider, geocoder.
`worker` → Postgres, object storage, email provider. `bot` → Postgres, chat platform.
`vision` → `web`. **No process calls another's HTTP API except those two machine paths, and
`web` never calls `bot`** (§1): the centre and the bot integrate through two tables and nothing
else.

---

## 2. Repository and package layout

One repository, pnpm workspaces. The spec requires one implementation of the clinical rules
(§11.3); that requires the web app and the bot to import the same package, and that requires
them to live in one workspace.

```
blood-connect/
  apps/
    web/                       # A + B: Next.js. Two entrypoints: server (A), worker (B)
      src/
        modules/
          platform/            # auth, accounts, email, audit, config, storage, jobs
          hospital/            # Module 1: patients, admissions, requests, samples
          centre/              # Module 2: inventory, tags, decisions, demand, vision
          volunteer/           # Module 4: read-only aggregates
        db/                    # connection, generated schema types
        app/                   # routes — the only place that knows about HTTP
        worker/                # job registry + entrypoint
    bot/                       # C: chat adapters, ticker, journey use cases
      src/
        channels/              # telegram/, whatsapp/ — one directory per adapter
        onboarding/ matching/ journey/ selfservice/ admin/
        db/ worker/
    vision/                    # D: Python, FastAPI, model, calibration evaluation
  packages/
    domain/                    # pure clinical rules — no I/O, no framework, no clock
    contract/                  # §7 tables: schemas, types, transitions, contract tests
    config/                    # typed clinical configuration loader + defaults
    result/                    # Result type and the error taxonomy
    ids/                       # branded id types and constructors
    testing/                   # fixtures, fake clock, fake channel, db harness
  db/
    migrations/                # hospital + reference; the ONLY creator of the shared tables
    migrations-bot/            # bot schema, applied by the bot's release
    seeds/                     # first admin, location hierarchy, product shelf lives
  docs/                        # the specs and this plan
```

**Module ownership inside `apps/web`.** §11.2 forbids one module reading another's tables. The
four directories under `modules/` are that boundary, and each exposes exactly one `index.ts`:

| Module dir | Owns | May import | Must never |
|---|---|---|---|
| `platform` | users, sessions, invites, OTPs, update requests, email, audit, config, jobs, storage | `packages/*` | know what a blood request is |
| `hospital` | patients, admissions, blood_requests, blood_samples, counters | `platform`, `packages/*` | read a `blood_bags` row |
| `centre` | bags, tags, assignments, returns, discards, decisions, discrepancies, devices, calibrations, observations, reconciliations; **writes** `donor_demand` | `platform`, `packages/*`, `hospital`'s published read API | read the `bot` schema |
| `volunteer` | nothing | `platform`, `packages/*`, `contract` | read patients, requests, or donor names |

The centre needs request data to build its queue, and that is the one legitimate cross-module
read: `hospital` publishes a narrow read API (`getSubmittedRequestsForCentre`,
`getRequestForDecision`) returning a purpose-built view type, and `centre` calls that function
rather than the `blood_requests` table. When the centre is split into its own deployment (§4),
that function becomes an HTTP call and nothing else changes.

**Enforcement.** `eslint-plugin-import`'s `no-restricted-paths` (or `dependency-cruiser`) in CI,
per §11.2: deep imports into any `modules/*/…` or `packages/*/src/…` path fail the build;
`packages/domain` may not import anything outside itself; `apps/*` may not import each other.

---

## 3. Layering and the dependency rule

§11.1, made concrete. Three layers per module, dependencies inward only.

| Layer | Lives in | May do | May not do |
|---|---|---|---|
| **Domain** | `packages/domain`, plus `modules/*/domain` for module-local rules | Pure functions and types: ABO/Rh matrix, eligibility predicate, screening gate, state machines, expiry and interval arithmetic, request-ID formatting | Read the clock, the network, the database, or `Math.random`; import a framework, a driver, or a chat SDK |
| **Application** | `modules/*/use-cases` | Open exactly one transaction, call the domain, call ports, write audit and outbox rows, return a `Result` | Know about HTTP, cookies, Telegram, or React |
| **Adapters** | `modules/*/repositories`, `modules/*/ports/*`, `app/`, `channels/` | Parse input at the boundary, map rows to domain types, call the outside world | Contain a clinical rule |

**Three rules that keep the layering honest:**

1. **Time, randomness and identity are injected.** Every use case takes a context
   `{ db, clock, ids, ports, actor, correlationId }`, and a domain function that needs "now"
   takes `now: Instant` as a parameter (§11.4). This is what makes interval, expiry and
   wave-timing logic testable without freezing a global clock.
2. **The use case is the transaction boundary.** No repository opens its own transaction and no
   route handler opens one, so "what happens atomically" is readable in a single file (§11.1).
3. **Parse once, at the edge.** A Zod schema at every boundary — HTTP body, chat callback,
   device POST, env var, config row — turns unknown input into a branded domain type. Nothing
   downstream re-validates (§11.4).

**Expected failures are values.** `packages/result` exports `Result<T, E>` where `E` is a
discriminated union per use case: `TagAlreadyAssigned`, `RequestAlreadyDecided`,
`InsufficientStock`, `OtpExpired`, `DonorNotEligible`. Adapters map those to an HTTP status or a
chat message. Exceptions are for bugs and infrastructure faults (§11.4) — "tag already assigned"
is not exceptional, it is Tuesday.

**State machines are discriminated unions with exhaustive switches**, all four in
`packages/domain`, each with its transition table as data and a `never` assertion so adding a
state breaks the build everywhere it must be handled:

| Machine | States |
|---|---|
| Blood request | `draft → submitted → decided(approved / partial / declined)` · `cancelled` |
| Bag lifecycle | `available → reserved → issued → returned → {available, quarantined, discarded}` · `quarantined → {available, discarded}` · `expired` · `lost` |
| Demand | `open → {fulfilled → completed, cancelled, expired}` |
| Donor journey | `NOTIFIED → {ACCEPTED, DECLINED, REQUEST_FILLED} → SCREENING → {CONFIRMED, DEFERRED} → {COMPLETED, NO_SHOW, CANCELLED}` |

`overdue` is **derived** (`date_required < today AND no decision`), not stored: a stored flag
needs a job to set it, and a request that becomes overdue at 00:01 must be flagged on the queue
at 00:01 (§3, §8).

---

## 4. Stack decisions

| Layer | Choice | Fixed by spec? | Note |
|---|---|---|---|
| Database | PostgreSQL 16+ | **Yes** (§11.3) | `FOR UPDATE SKIP LOCKED`, partial unique indexes, transactional counters, schema separation and column grants are all load-bearing |
| Web app | TypeScript, Next.js App Router | Framework replaceable; TypeScript is not | The earlier implementation used it; nothing is ported |
| Bot language | **TypeScript** | The one open decision in §11.3 | Decided here — see below |
| Schema and migrations | Drizzle ORM + drizzle-kit | Tool replaceable; "migrations only" is not | Types generated from SQL, multi-schema support, and it does not hide the SQL §7 depends on |
| Validation | Zod at every boundary | Library replaceable; boundary validation is not | Shared schemas in `packages/contract` and `modules/*/schemas` |
| Vision inference | Python + FastAPI | **Yes** (§11.3) | Behind the device API, so it is an adapter like any other |
| Job scheduling | In-database job table + advisory-locked worker | — | No Redis: one fewer dependency, and every job run is an auditable row |
| Object storage | S3-compatible, private buckets, streamed through authenticated routes | — | Seals (§3) and camera frames (§4) |
| Email | Provider behind an `EmailPort`, delivery status recorded | Provider replaceable (§2.4) | The invite / OTP / outcome flows depend on it |

**Decision: the bot is TypeScript.** §11.3 leaves this open and recommends TypeScript; this plan
takes the recommendation. The deciding argument is the spec's own — blood-group compatibility
and donor eligibility are clinical rules that must never disagree between two implementations,
and the only way to guarantee that is to have one implementation. Here that is
`packages/domain`, imported by both `apps/web` and `apps/bot`. Python stays where there is no
shared rule to duplicate: `apps/vision`.

The cost is accepted deliberately: `grammy` (Telegram) and the WhatsApp Cloud API's plain HTTP
interface are both adequate behind the channel port (§2.11), and neither is a rule engine.

**One duplication remains and cannot be removed.** The eligibility predicate exists twice by
necessity — as TypeScript, to check one donor arriving on a deep link, and as SQL, to select a
wave of twenty without loading the donor pool into memory (§5). [§7.7](#77-selecting-a-wave-and-the-predicate-that-exists-twice)
handles it with a shared threshold source and a mandatory agreement test.

---

## 5. Data architecture

### 5.1 Schemas, roles and grants

One database, three schemas, three roles. §11.5 asks for ownership the database itself enforces.

| Schema | Created by | Owner | Contents |
|---|---|---|---|
| `hospital` | `db/migrations`, applied as `migrator` | `web` | Modules 1, 2 and 4 — including the two shared tables of §7 |
| `bot` | `db/migrations-bot`, applied as `migrator` | `bot` | Donors, journeys, conversation state, event log, outbox |
| `reference` | `db/migrations` | `web`, read-only to `bot` | The seeded location hierarchy and its versions |

```sql
-- the contract, and nothing else, is what the bot may touch in hospital
GRANT USAGE ON SCHEMA hospital TO app_bot;
GRANT SELECT ON hospital.donor_demand TO app_bot;
GRANT UPDATE (bot_public_id, imported_at, donors_notified, confirmed_units,
              waitlisted_units, completed_units, status, updated_at)
  ON hospital.donor_demand TO app_bot;
GRANT SELECT, INSERT ON hospital.donor_demand_confirmations TO app_bot;
GRANT UPDATE (status, acknowledged_at, updated_at)
  ON hospital.donor_demand_confirmations TO app_bot;
-- erasure has to reach the roster (§12.1, 1.3.0): the name and the number go,
-- the unit number and the date stay -- that is the donation record
GRANT UPDATE (donor_name, donor_phone)
  ON hospital.donor_demand_confirmations TO app_bot;
-- a unit collected outside the bot is a unit it must stop recruiting for; it
-- reads them and writes nothing (1.2.0)
GRANT SELECT ON hospital.walk_in_donations TO app_bot;
-- everything else in hospital stays unreachable to app_bot, blood_bags included

GRANT USAGE ON SCHEMA reference TO app_bot;
GRANT SELECT ON ALL TABLES IN SCHEMA reference TO app_bot;

-- and the reverse: the web app gets nothing in the bot's schema
REVOKE ALL ON SCHEMA bot FROM app_web;
```

That last line is the one worth defending in review. Module 4 reads "the bot's progress
counters" (§6) — but the bot writes those counters onto `donor_demand`, which lives in
`hospital`. So the volunteer dashboard needs no access to the `bot` schema at all, and the web
app is given none. A privacy boundary (§2.10) that is a missing grant cannot be crossed by a
careless join.

**Column-level `UPDATE` grants are how §7's "written by" column becomes real.** The bot
physically cannot set `units` or `hospital_name` on a demand; the centre physically cannot set
`confirmed_units`. Application logic is the second line of defence, not the first (§11.5).

### 5.2 Conventions

- **Primary keys**: UUIDv7 `uuid` columns generated in application code from `packages/ids` —
  time-ordered, so index locality is good, and a key does not leak a count. Branded in
  TypeScript: a `BagId` is not assignable to a `DemandId` (§11.4).
- **Human-readable identifiers are separate columns**: `blood_requests.request_id`
  (`BR-YYYY-NNNNNN`), `donor_demand.bot_public_id`, `blood_bags.unit_number`.
- **Every table** carries `created_at timestamptz not null default now()` and `updated_at
  timestamptz not null` maintained by a trigger (§11.5).
- **Timestamps** are `timestamptz` stored UTC. **Calendar days** — `date_required`,
  `collected_at`, `expires_at`, `donated_at` — are `date`, because §7 says the centre records a
  day. Converting a day to an instant uses one configured application timezone
  (`Asia/Kolkata`) in one function, so "expires 23:59 local" exists exactly once.
- **Enumerations** are `text` + `CHECK` rather than Postgres `enum` types: adding a value is a
  migration either way, but a `CHECK` changes without a table rewrite, and the TypeScript union
  stays the authority.
- **Floats appear only for confidences** (`real`) — the one genuinely approximate value here.
- **Snapshot columns are named `*_snapshot`** or grouped in a `jsonb snapshot` where the set is
  wide, so §2.6 is visible in the schema. A snapshot column is never joined on.

### 5.3 Table inventory — `hospital`, platform

| Table | Key columns | Constraints and indexes worth stating |
|---|---|---|
| `users` | id, email citext unique, full_name, role, provisional_reg, district_scope_id, status (`pending_activation`/`active`/`deactivated`), password_hash (null until activated), last_login_at | Unique on `lower(email)`; unique on `provisional_reg` where present; index `(role, status)` for the last-active-admin check |
| `sessions` | id, user_id, token_hash unique, expires_at, revoked_at, ip, user_agent | Index `(user_id) WHERE revoked_at IS NULL` — a password reset revokes every session (§3) |
| `auth_rate_limits` | scope (`login_ip`/`login_account`/`otp_ip`/`otp_account`), key, window_start, attempts | Unique `(scope, key, window_start)`; the login and OTP throttles deliberately share this table (§3) |
| `account_invites` | id, user_id, token_hash unique, expires_at, consumed_at, superseded_at, sent_by | Partial unique `(user_id) WHERE consumed_at IS NULL AND superseded_at IS NULL` — one live invite per account; a re-send supersedes (§2.3) |
| `password_reset_otps` | id, user_id, otp_hash, expires_at, consumed_at, attempts, superseded_at | Same partial-unique shape; a newer OTP invalidates the previous (§3) |
| `account_update_requests` | id, user_id, field, current_value_snapshot, proposed_value, reason, status, decided_by, decided_at, note | **Partial unique `(user_id, field) WHERE status = 'pending'`** — "one pending request per field"; `CHECK (decided_by IS NULL OR decided_by <> user_id)` so nobody approves their own (§3, §14) |
| `email_deliveries` | id, user_id, kind, to_address, template_version, status (`queued`/`sent`/`delivered`/`bounced`/`complained`/`failed`), provider_message_id, attempts, next_attempt_at, last_error, payload jsonb | **This is the email outbox**, not a log written after the fact. Index `(status, next_attempt_at)` for the drain |
| `audit_log` | id, occurred_at, actor_user_id, actor_kind (`user`/`device`/`system`/`bot`), action, subject_type, subject_id, correlation_id, metadata jsonb | Append-only: `REVOKE UPDATE, DELETE … FROM app_web`. Indexes `(subject_type, subject_id, occurred_at)` and `(correlation_id)` |
| `app_config` | key, value jsonb, updated_by, updated_at, effective_from | Every clinical threshold (§12); every change audited |
| `jobs` | id, name, run_after, started_at, finished_at, status, attempts, last_error, payload jsonb, idempotency_key unique | The worker's queue and schedule in one table (§11) |
| `object_refs` | id, bucket, key, content_type, byte_size, sha256, kind (`seal`/`frame`), owner_id, delete_after | One row per stored object, so retention (§12.3) is a query rather than a bucket crawl |

### 5.4 Table inventory — `hospital`, Module 1

| Table | Key columns | Constraints and indexes |
|---|---|---|
| `patients` | id, name, dob date, age int, age_unit, sex, blood_group, uhid, attender_name, attender_phone, address, district_id, city_id, diagnosis, history, previous_transfusion, previous_reaction | `CHECK (dob IS NOT NULL OR (age IS NOT NULL AND age_unit IS NOT NULL))` — the neonate case (§3); unique on `uhid` where present; trigram index on `name` for the duplicate warning |
| `admissions` | id, ip_no unique, patient_id, ward, admitted_at, discharged_at, status | `ip_no` immutable after insert (trigger); `CHECK (discharged_at IS NULL OR discharged_at >= admitted_at)`; index `(patient_id, admitted_at desc)` |
| `blood_requests` | id, request_id, centre_id, admission_id, doctor_id, status, indication, date_required date, blood_group, product, units, submitted_at, cancelled_at, cancel_reason, `patient_snapshot jsonb`, `doctor_snapshot jsonb` | Unique on `request_id`; `CHECK (status <> 'submitted' OR (request_id IS NOT NULL AND patient_snapshot IS NOT NULL))` (§2.6); index `(status, date_required)` for the centre queue and the overdue flag; index `(doctor_id, updated_at desc)` for stale-draft ages |
| `blood_samples` | id, request_id, sample_identifier, collected_at, collected_by_doctor_id | Unique on `sample_identifier` **alone** — globally unique per §15 |
| `blood_request_counters` | year PK, next_value | The transactional allocator in [§7.1](#71-allocating-a-request-id-at-submit) |

`centre_id` is on `blood_requests` and `donor_demand` from day one so multi-tenant is not a
retrofit (§13), even though v1 runs one centre.

### 5.5 Table inventory — `hospital`, Module 2

| Table | Key columns | Constraints and indexes |
|---|---|---|
| `centre_settings` | id, hospital_name, address, district_id, city_id, min_units_per_group, return_time_limit_minutes | `CHECK (id = 1)` — the single row (§4) |
| `product_shelf_lives` | product PK, shelf_life_days, updated_by | Drives the derived expiry at intake (§4) |
| `rfid_tags` | tag_uid PK, status (`unassigned`/`assigned`/`retired`), current_bag_id, retired_at, retire_reason | `CHECK (status <> 'assigned' OR current_bag_id IS NOT NULL)` and `CHECK (status <> 'retired' OR current_bag_id IS NULL)` — a retired tag can never carry a bag again |
| `blood_bags` | id, unit_number unique, blood_group, product, collected_at date, expires_at date, expiry_source (`derived`/`label`), source, status, reserved_for_request_id, issued_to_request_id, issued_at | `CHECK (expires_at >= collected_at)`; **partial index `(blood_group, product, expires_at) WHERE status = 'available'`** — the index the decision transaction lives on; `CHECK (status <> 'reserved' OR reserved_for_request_id IS NOT NULL)` |
| `tag_assignments` | id, tag_uid, bag_id, assigned_at, assigned_by, released_at, released_by, release_reason | Append-only. **Partial unique `(tag_uid) WHERE released_at IS NULL`** and **partial unique `(bag_id) WHERE released_at IS NULL`** — one live assignment each way, which is what makes the three collision cases decidable from the register alone (§4) |
| `bag_returns` | id, bag_id, returned_at, out_of_storage_band, cold_chain_documented, outcome (`restock`/`quarantine`/`discard`), note, decided_by | Never writes `expires_at` (§4) — asserted by a test, not only by review |
| `bag_quarantines` | id, bag_id, reason, opened_at, resolved_at, resolution (`available`/`discarded`), resolved_by, note | Partial unique `(bag_id) WHERE resolved_at IS NULL`; index on `opened_at` for the ageing escalation |
| `bag_discards` | id, bag_id, reason, note, disposal_route, discarded_by, discarded_at | `disposal_route` required — a status change is not the end of the bag (§12.1) |
| `tag_discrepancies` | id, tag_uid, presented_at, presented_by, conflicting_bag_id, status, finding (`duplicate_tag`/`bag_missing`/`mis_scan`), note, resolved_by, resolved_at | **Never auto-resolves and never expires** (§4): no job touches this table, and that absence is deliberate and commented. Index `(status, presented_at)` |
| `centre_decisions` | id, request_id **unique**, decision, units_issued, note, decided_by, decided_at, demand_id | The unique constraint is what actually prevents a request being decided twice (§11.5) |
| `decision_bags` | decision_id, bag_id | `PRIMARY KEY (decision_id, bag_id)`, plus unique on `bag_id` — a bag is issued once |
| `storage_devices` | id, name, storage_unit, kind (`camera`/`reader`), token_hash unique, revoked_at, last_seen_at | Token shown once, stored hashed (§15); `last_seen_at` drives the "camera stopped reporting" alert |
| `camera_calibrations` | id, device_id, version, reference_frame_ref, activated_at, activated_by, retired_at | Unique `(device_id, version)`; partial unique `(device_id) WHERE activated_at IS NOT NULL AND retired_at IS NULL` |
| `calibration_regions` | id, calibration_id, label, polygon jsonb, blood_group, product, expected_capacity | The group comes from geometry, never from the pixels (§4) |
| `stock_observations` | id, device_id, calibration_id, captured_at, frame_ref, drift_score, received_at, idempotency_key unique | Rejected if the calibration is not the device's active one (§15) |
| `observation_regions` | observation_id, region_id, count, confidence, below_threshold bool | `below_threshold` records "no observation", which is **never** stored as a count of zero (§4) |
| `stock_reconciliations` | id, observation_id, region_id, expected, observed, status, resolution (`register_corrected`/`dismissed`), note, resolved_by | Index `(status, created_at)` for the overview and the ageing alert |

### 5.6 Table inventory — `hospital`, the shared contract (§7)

Created only by `db/migrations`. Columns follow §7 exactly; see [§6](#6-the-shared-contract).

| Table | Written by | Notes |
|---|---|---|
| `donor_demand` | centre (raise, cancel), bot (import, progress, close) | Index `(status, bot_public_id) WHERE status = 'open' AND bot_public_id IS NULL` — the bot's poll; **partial unique `(blood_group) WHERE trigger = 'stock_floor' AND status = 'open'`** so "recruit for groups below floor" cannot double-raise (§4) |
| `donor_demand_confirmations` | bot (create, acknowledge), centre (counter outcome) | Unique `(demand_id, donor_id)` on the bot's **internal** donor id (§7, §2.11); `channel` carried alongside so the counter knows where the person was reached |
| `walk_in_donations` | centre only; bot reads | Somebody who gave without ever being in the bot (contract 1.2.0). Its own table because the centre has no INSERT on the roster — the bot creates that. The bot reads it and stops recruiting for a unit already collected |

### 5.7 Table inventory — `bot`

| Table | Key columns | Notes |
|---|---|---|
| `donors` | id, name, dob, sex, blood_group, blood_group_verified_at, weight_band, weight_kg, district_id / city_id / town_id / locality_id plus the donor's own `*_text`, last_donated_on, next_eligible_on, durable_flag_status, snooze_until, opted_out_at, deleted_at, consent_current_at, language | `next_eligible_on` is **stored**, recomputed by the domain on every change, and indexed — a wave query cannot compute an interval per row across a large pool. `consent_current_at` is likewise denormalised so the wave query stays indexable; `donor_consents` remains the authoritative history. `weight_kg` is derived from the band's lower bound when the donor gives no exact figure, so the threshold comparison is never null-skipped |
| `donor_channels` | donor_id, channel, channel_user_id, opted_in_at | Unique `(channel, channel_user_id)` (§2.11) |
| `donor_phones` | donor_id, e164, verified, verified_at | The verified number links one person across channels; unique `(e164) WHERE verified` |
| `donor_consents` | id, donor_id, consented_at, wording_version, values_snapshot jsonb, withdrawn_at | "They consented to *this text*, showing *these values*, at *this time*" (§5) |
| `donor_screening_answers` | donor_id, question_key, answer, answered_at | **Durable answers only.** Temporary ones live on the journey row and never touch the profile (§5) |
| `bot_requests` | id, demand_id unique, public_id unique, blood_group, product, units_needed, confirmed_count, waitlisted_count, completed_count, needed_by, hospital_snapshot jsonb, status, next_wave_at, wave_no, closed_at, closure_reason | `next_wave_at` is **a column polled by the ticker, not an in-memory timer** (§5); index `(status, next_wave_at)` |
| `donor_requests` | id, bot_request_id, donor_id, status, wave_no, notified_at, responded_at, screening_index, screening_answers jsonb, confirmed_at, terminal_at, card_ref | Unique `(bot_request_id, donor_id)`; questionnaire progress lives here, not in session memory (§5); index `(bot_request_id, status)` |
| `volunteer_admins` | id, channel, channel_user_id, district_id (null = all), added_by | Manual whitelist, optionally district-scoped (§5) |
| `admin_cards` | id, bot_request_id, admin_id, message_ref, last_rendered_counts jsonb | Lets a card be edited in place where the channel allows it |
| `conversation_state` | id, channel, channel_user_id, flow, step, draft jsonb, expires_at | Resumable onboarding: **progress lives in the database, not process memory** (§5), and nothing in `draft` is committed until step 10 |
| `event_log` | id, occurred_at, subject_type, subject_id, event, correlation_id, metadata jsonb | Append-only state transitions (§2.9) |
| `message_outbox` | id, channel, channel_user_id, kind, payload jsonb, status, attempts, next_attempt_at, dedupe_key unique | **The stand-down guarantee** — see [§7.6](#76-closing-a-demand--the-outbox) |
| `bot_jobs` | same shape as `hospital.jobs` | The bot's own scheduled work |
| `locality_review_queue` | id, donor_id, raw_text, level, parent_id, status, resolved_to_id | Unmatched free text never silently creates a place (§5) |

### 5.8 Table inventory — `reference`

| Table | Notes |
|---|---|
| `location_nodes` | id, level (`district`/`city`/`town`/`locality`), parent_id, name, name_normalised, dataset_version. Self-referencing hierarchy; index `(parent_id, name_normalised)` for the type-ahead, trigram index on `name_normalised` for search |
| `location_aliases` | node_id, alias_normalised — Kerala localities have several romanised spellings each (§5), and matching without aliases fragments the donor pool |
| `location_dataset_versions` | version, source, imported_at — the hierarchy is seeded **and versioned** (§5) |

**Deviation, stated.** §5 lists `location_hierarchy` among the bot's data. This plan puts it in
a shared `reference` schema owned by the web app's migrations, because Module 1 (patient
district and city), Module 2 (centre settings) and Module 4 (district scoping) all need it, and
the alternatives are the web app reading a bot table — forbidden by §11.2 — or two copies of a
dataset that must agree for proximity ordering to mean anything. Logged as a spec delta in
[§19](#19-decisions-taken-deviations-and-open-questions).

### 5.9 Migrations

- **Migrations only, never auto-create** (§11.5). `db:push` works against a scratch database and
  is blocked in CI and in every deployed environment by an env guard.
- Two migration sets, two applications: `db/migrations` (hospital + reference, run by the web
  release) and `db/migrations-bot` (bot schema, run by the bot release). Both run as `migrator`;
  neither application role holds DDL rights.
- **The shared tables exist only in `db/migrations`.** A CI check greps `migrations-bot` for
  `donor_demand` and fails the build if it appears (§2.1).
- Every migration is forward-only with a written rollback plan; a destructive one needs a backup
  verified by restoring it (§11.5).
- CI applies the full set to an empty database **and** to a copy seeded from the previous
  release, so "the migration applies cleanly" covers both cases.

---

## 6. The shared contract

`packages/contract` is the versioned package §11.2 asks for. Both `apps/web` and `apps/bot`
depend on it; neither depends on the other.

| Export | What it is |
|---|---|
| `DonorDemandRow`, `DonorDemandConfirmationRow` | Zod schemas and inferred types for the two tables |
| `demandTransitions`, `confirmationTransitions` | Which side may move which status where — §7's table, as data |
| `canCentreWrite(column)`, `canBotWrite(column)` | The column ownership from §7, callable in a test |
| `CONTRACT_VERSION` | Semver, asserted at boot by both processes against the value stored in `app_config` |

**Contract tests run in both codebases** (§11.6). The web suite asserts the centre only writes
centre-owned columns and only makes centre-legal transitions; the bot suite asserts the same for
the bot; a shared suite asserts the migration's actual column list matches the schema. §11.2
names a one-sided change to `donor_demand` as the most likely way this system breaks in
production, so the check is mechanical rather than procedural.

**Versioning** (§11.8): additive columns are a minor bump; anything else is major and requires
both sides shipped in the same release. The boot-time assertion turns a mismatched deploy into a
refused start instead of silent corruption.

---

## 7. Transactions and concurrency

Seven places where the correct answer depends on doing it in one statement or one transaction.
Each gets a comment in the code saying what breaks if it is "simplified" (§11.4) and a
deliberate concurrency test against real Postgres (§11.6).

### 7.1 Allocating a Request ID at submit

```sql
INSERT INTO hospital.blood_request_counters (year, next_value) VALUES ($year, 2)
ON CONFLICT (year) DO UPDATE SET next_value = blood_request_counters.next_value + 1
RETURNING next_value - 1 AS allocated;
```

One statement inside the submit transaction, which also freezes the snapshots and flips the
status. Two doctors submitting in the same millisecond serialise on the counter row and get
consecutive numbers, and no number is burned by a failed submit because allocation and submit
commit together.

### 7.2 Deciding a request — the whole decision is one transaction

```sql
BEGIN;
  -- 1. claim bags: oldest expiry first, skipping any another counter already holds
  SELECT id FROM hospital.blood_bags
   WHERE blood_group = $group AND product = $product AND status = 'available'
   ORDER BY expires_at ASC, id ASC
   LIMIT $units
   FOR UPDATE SKIP LOCKED;
  -- 2. the unique constraint on request_id is what stops a second decision
  INSERT INTO hospital.centre_decisions (request_id, decision, units_issued, …) VALUES (…);
  -- 3. reserve exactly the bags returned by (1)
  UPDATE hospital.blood_bags SET status = 'reserved', reserved_for_request_id = $req
   WHERE id = ANY($ids);
  INSERT INTO hospital.decision_bags …;
  -- 4. shortfall AND product is whole blood or PRBC → raise demand in the same transaction
  INSERT INTO hospital.donor_demand (…) …;
COMMIT;
```

`SKIP LOCKED` is why two staff deciding two different requests for the same group never contend
(§4). The unique constraint in step 2 is why they cannot both decide the *same* request: the
second transaction fails on the constraint and the use case returns `RequestAlreadyDecided` — a
`Result`, not an exception. Steps 2 and 4 sharing a transaction is why a shortfall can never
exist without its demand row.

### 7.3 Claiming the last unit

```sql
UPDATE bot.bot_requests
   SET confirmed_count = confirmed_count + 1
 WHERE id = $req AND confirmed_count < units_needed
RETURNING confirmed_count;
```

One conditional UPDATE, never a read-then-write. Two donors finishing screening at the same
instant contend on one row: exactly one matches and is confirmed, the other gets zero rows and
is waitlisted (§5). The insert into `donor_demand_confirmations` and the journey-row transition
ride in the same transaction as the successful UPDATE.

### 7.4 Replayed chat callbacks

```sql
UPDATE bot.donor_requests SET status = 'ACCEPTED', responded_at = $now
 WHERE id = $row AND status = 'NOTIFIED'
RETURNING id;
```

Every transition is a conditional UPDATE guarded on the status it expects, reporting whether it
actually moved. A redelivered callback matches nothing and is a no-op (§5). Questionnaire
progress is compared against `screening_index` on the row, so a duplicate tap on question 3 is
recognised as already answered — and the flow survives a restart, because the index is in the
database rather than in session memory.

### 7.5 Tag intake and the three collisions

The live-assignment partial unique index (`tag_assignments (tag_uid) WHERE released_at IS NULL`)
turns the three cases of §4 into a lookup rather than a race:

```sql
BEGIN;
  SELECT * FROM hospital.rfid_tags WHERE tag_uid = $tag FOR UPDATE;  -- serialise on the tag
  --  unassigned                      → intake: INSERT bag, INSERT assignment, UPDATE tag
  --  assigned, bag issued/reserved   → case 1, return flow
  --  assigned, bag terminal          → case 2, release then re-register as a NEW bag
  --  assigned, bag available         → case 3: INSERT tag_discrepancies, and stop
COMMIT;
```

Case 3 writes a discrepancy and returns `TagConflict`. **There is no resolution path on this
transaction**, by design (§4, §14) — the pressure to add a "resolve anyway" button will come
from busy staff, and the answer is no. Two operators scanning the same tag at once serialise on
the `FOR UPDATE`, so exactly one intake succeeds and the second sees the tag as assigned.

### 7.6 Closing a demand — the outbox

A demand closes exactly one way of four, and the closure must fan out stand-down messages and
stop recruitment **in the same pass** (§5). The spec names "a demand closed without its
stand-down messages sent" as the failure this system must not have — so the messages are not
sent inside the closing transaction, where a chat API timeout after the commit would lose them
silently.

```sql
BEGIN;
  UPDATE bot.bot_requests SET status = 'cancelled', closed_at = $now
   WHERE id = $req AND status IN ('open','fulfilled') RETURNING id;      -- idempotent close
  UPDATE bot.donor_requests SET status = 'CANCELLED', terminal_at = $now
   WHERE bot_request_id = $req
     AND status IN ('NOTIFIED','ACCEPTED','SCREENING','CONFIRMED','REQUEST_FILLED');
  INSERT INTO bot.message_outbox (channel, channel_user_id, kind, payload, dedupe_key)
  SELECT … FROM bot.donor_requests WHERE bot_request_id = $req AND …;    -- one row per donor
COMMIT;
-- a separate worker drains the outbox with retries; dedupe_key makes redelivery harmless
```

The outbox is also what makes the §11.9 alert implementable: `SELECT count(*) FROM
bot.message_outbox WHERE kind = 'stand_down' AND status <> 'sent' AND created_at < now() -
interval '5 minutes'`. The same pattern carries every email — `email_deliveries` is the web
app's outbox, so the invite, the OTP and the update-request outcome are all rows committed with
the action that caused them.

### 7.7 Selecting a wave, and the predicate that exists twice

A wave is 20 eligible donors ordered by proximity down the hierarchy, then longest-since-donation
(§5). That has to be SQL — filtering a donor pool in Node does not scale, and the ordering would
still be SQL:

```sql
SELECT d.id
  FROM bot.donors d
 WHERE d.blood_group = ANY($compatibleGroups)      -- from packages/domain, ABO/Rh matrix
   AND d.blood_group_verified_at IS NOT NULL
   AND d.next_eligible_on <= $today
   AND d.dob BETWEEN $today - $maxAgeYears AND $today - $minAgeYears   -- 18-65, from config
   AND d.weight_kg >= $minWeight                   -- config, not constants (§12)
   AND d.durable_flag_status = 'clear'
   AND (d.snooze_until IS NULL OR d.snooze_until <= $today)
   AND d.opted_out_at IS NULL AND d.deleted_at IS NULL
   AND d.consent_current_at IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM bot.donor_requests r
                    WHERE r.donor_id = d.id AND r.bot_request_id = $req)
 ORDER BY CASE WHEN d.locality_id = $loc  THEN 0 WHEN d.town_id = $town THEN 1
               WHEN d.city_id     = $city THEN 2 WHEN d.district_id = $dist THEN 3 END,
          d.last_donated_on ASC NULLS FIRST
 LIMIT $waveSize;
```

The same rules exist in TypeScript to check one donor arriving on a deep link. **The agreement
test is mandatory** (§11.3): seed a few hundred donors spanning every boundary — exactly 18 and
exactly 65, exactly at the weight threshold, one day either side of the interval — run both, and
assert the sets are identical. It runs on every CI build, not on request. Both readings take
their thresholds from the same config object (§12), so a revised interval cannot move one and
not the other.

---

## 8. Application layer — use case inventory

Every transaction in the system, by module. This is the backend's real surface area: a route
handler, a server action, a chat callback and a job all reduce to "parse, call one of these,
map the `Result`". Each returns `Result<T, E>` and each writes its audit event (§2.9).

### 8.1 `platform` — accounts, auth, email, config

| Use case | Transaction does | Notable rule |
|---|---|---|
| `createAccount` | Insert user (`pending_activation`), insert invite, insert `email_deliveries` row | No password field exists; the admin never knows one (§2.3) |
| `resendInvite` | Supersede the live invite, insert a new one + email row | Invalidates the previous link (§15) |
| `consumeInvite` | Verify hash + expiry, set password, mark consumed, **create session** | Setting the password signs them in and lands them on their dashboard (§3) |
| `signIn` | Check throttle, verify password, insert session, audit | Identical message for wrong user and wrong password (§15) |
| `signOut` / `revokeAllSessions` | Set `revoked_at` | Reset revokes every session (§3) |
| `requestPasswordOtp` | Throttle, supersede prior OTP, insert hashed OTP + email row | **Response is identical whether or not the account exists** (§3) |
| `verifyOtpAndReset` | Verify, consume, set password, revoke sessions, create session, queue "your password changed" email | Expired/exhausted returns to step one with a way to retry, not a generic error (§8) |
| `changePassword` | Verify current, set new, revoke other sessions | Min 12 chars (§15) |
| `submitUpdateRequest` | Insert pending request | Partial unique makes "one pending per field" a constraint, not a check (§3) |
| `withdrawUpdateRequest` | Close as withdrawn | Only while pending |
| `decideUpdateRequest` | Apply the change **by the system**, mark decided, queue notifications | Email change notifies **both** addresses and invalidates outstanding OTPs; `decided_by <> user_id` (§3) |
| `changeRole` / `setAccountStatus` | Update user | Cannot touch own account; last active admin protected — checked with `SELECT … FOR UPDATE` on the admin set so two concurrent demotions cannot both pass (§3) |
| `uploadSeal` | Re-encode PNG server-side, put to object storage, insert `object_refs`, update user | PNG only, ≤1 MB; served only through an authenticated route (§3) |
| `setConfig` | Update `app_config`, audit old → new | Clinical thresholds are data (§12) |

### 8.2 `hospital` — Module 1

| Use case | Transaction does | Notable rule |
|---|---|---|
| `createPatient` / `updatePatient` | Upsert patient | Duplicate warning is a **read** before the write, never a hard block (§3) |
| `createAdmission` / `dischargeAdmission` | Insert / update by `ip_no` | `ip_no` is the admission's identity and immutable |
| `createDraft` / `updateDraft` | Upsert draft | Owner only; refuses anything not `draft` (§2.6) |
| `submitRequest` | Allocate `BR-YYYY-NNNNNN` (§7.1), write both snapshots, set `submitted` | One transaction; draft endpoints refuse the record from then on |
| `cancelRequest` | Set cancelled + reason, release reserved bags, cancel any open demand | The cancel cascades into §7.6's stand-down — the whole point of the flow (§3) |
| `associateSample` | Insert sample | Submitted requests only; `sample_identifier` globally unique |
| `listDashboard` | Read | Returns draft ages so stale drafts surface (§3) |
| *(published read API)* `getSubmittedRequestsForCentre`, `getRequestForDecision` | Read | The one sanctioned cross-module read (§2) |

### 8.3 `centre` — Module 2

| Use case | Transaction does | Notable rule |
|---|---|---|
| `resolveTag` | Read tag + assigned bag, classify into unassigned / case 1 / case 2 / case 3 | Pure classification in the domain; the screen offers **only** the actions valid for that status (§4) |
| `registerBag` | Insert bag, insert assignment, set tag `assigned` | Expiry derived from `collected_at` + shelf life; a printed label overrides and a mismatch is flagged, not blocked (§4) |
| `returnBag` | Insert `bag_returns`, set bag status, open a quarantine row if quarantined | **Never recalculates expiry**; defaults to Quarantine when time out of storage is unknown (§4) |
| `resolveQuarantine` | Close quarantine, set bag `available` or `discarded` | Requires a named resolver; a quarantined bag reaching expiry is discarded by job with that reason (§4) |
| `releaseTag` | Close assignment, set tag `unassigned` or `retired` | Offered only when the assigned bag is terminal — case 2 (§4) |
| `raiseTagDiscrepancy` | Insert discrepancy | Case 3; no resolution offered here (§7.5) |
| `resolveTagDiscrepancy` | One of: retire tag + quarantine presented bag · mark conflicting bag `lost` + release tag · dismiss | Three findings, three fixed actions, resolver named (§4) |
| `discardBag` | Insert `bag_discards`, set status | `disposal_route` required (§12.1) |
| `decideRequest` | The transaction in §7.2 | One decision per request, enforced by the unique constraint |
| `recruitForFloor` | Per short group, insert one demand | The partial unique index makes double-raising impossible (§5.6) |
| `cancelDemand` | Set demand `cancelled` + reason | The bot's ticker sees the status and runs §7.6 |
| `markRosterOutcome` | Update confirmation row: `completed` / `no_show` / `cancelled`, `donated_at`, `bag_identifier` | The counter is the authority on who gave blood (§4) |
| `recordWalkIn` | Insert `walk_in_donations` | **Not a confirmation row**: the centre holds no INSERT there, and the first version of this was refused by the database as `app_web` (ADR 0008). Someone who never confirmed in the bot still needs their donation counted (§4) |
| `registerDevice` / `revokeDevice` | Insert with hashed token / set `revoked_at` | Token displayed once, never again (§15) |
| `saveCalibration` / `activateCalibration` | Insert calibration + regions; activate as a new version | Earlier observations keep their own version (§4) |
| `ingestObservation` | Insert observation + regions; open reconciliations where counts disagree | **Never writes the register** (§2.12); low confidence records "no observation", not zero |
| `resolveReconciliation` | Correct the register (which is itself an audited bag write) or dismiss | Stays open and visible until one of the two (§8) |
| `updateCentreSettings` | Update the single row | Snapshotted onto every new demand from here on, never retroactively (§2.6) |

### 8.4 `bot` — Module 3

| Use case | Transaction does | Notable rule |
|---|---|---|
| `importOpenDemand` | Insert `bot_requests` from `donor_demand`, set `bot_public_id` + `imported_at` | Idempotent on `demand_id`; a row is never fanned out twice (§5) |
| `advanceOnboarding` | Update `conversation_state.draft` | Nothing is committed to `donors` until step 10 (§5) |
| `commitRegistration` | Insert donor, channel, phone, screening answers, consent | One transaction; consent stores wording version + values snapshot (§5) |
| `applySummaryEdits` | Update the draft for a set of ticked fields, then re-record consent on save | Changing district resets city, town and locality (§5) |
| `sendWave` | Select 20 (§7.7), insert journey rows, enqueue cards, set `next_wave_at` | Wave timing is a polled column, so a restart resumes escalation (§5) |
| `acceptRequest` | Conditional UPDATE `NOTIFIED → ACCEPTED` (§7.4) | Replays are no-ops |
| `answerScreeningQuestion` | Append answer, advance `screening_index` | Temporary answers never touch the profile (§5) |
| `confirmDonor` | §7.3's conditional UPDATE, insert confirmation row, enqueue "hospital + time" | Loser is waitlisted rather than asked six questions for a place that no longer exists |
| `deferDonor` | Set `DEFERRED`, enqueue "this request only" message | Never phrased as a medical verdict (§5) |
| `closeDemand` | §7.6 | Completed / cancelled / expired — all fan out stand-downs |
| `promoteFromWaitlist` | Conditional claim of the freed unit, enqueue promotion | A waitlist that never resolves is worse than none (§5) |
| `applyCounterOutcome` | Read confirmations marked by the centre; roll interval forward on `completed`, enqueue thanks, set `acknowledged_at` | Rolling the interval uses the domain's interval rule, config-driven (§12) |
| `snooze` / `optOut` / `deleteMyData` | Update donor; deletion de-identifies confirmations rather than deleting them | Said plainly **before** deleting, in one sentence (§5) |
| `listDemandBoard` | Read | Open to everyone; matches first for a registered donor (§5) |

### 8.5 `volunteer` — Module 4

Read-only. `getGroupPressure` (eight tiles: outstanding, confirmed, below-floor), `getDemandsForGroup`,
`getShareMessage` (generated from live numbers, no free text), `getTrend`. Every query is
district-scoped by the volunteer's own scope, and none of them selects a patient, doctor or donor
column — asserted by a test that inspects the SQL, not just the response (§14).

---

## 9. API surfaces

Four kinds of caller, four kinds of authentication, and they never share a middleware.

### 9.1 Staff browser (Modules 1, 2, 4)

Session cookie, same-origin, CSRF-checked. Mutations are **server actions** that do nothing but
parse input with Zod and call one use case; reads are server components calling a repository.
Route handlers are used only where a browser needs a non-HTML response (seal image, frame image,
CSV export). The rule that matters: no business logic in `app/` (§3).

### 9.2 Machine callers — `/api/device/*`

Device token in a header, no session, no cookies, no CSRF (there is no browser). Tokens are
hashed at rest, individually revocable, and `last_seen_at` is written on every call (§4).

| Endpoint | Caller | Body | Notes |
|---|---|---|---|
| `POST /api/device/observations` | vision service | captured_at, calibration_version, regions[{region_id, count, confidence}], frame_ref, idempotency_key | Rejected if the calibration is not the device's active one, or if `captured_at` is far from server time (§15) |
| `GET /api/device/config` | vision service | — | Active calibration, regions, confidence threshold, capture schedule |
| `POST /api/device/frames` | vision service | multipart frame | Returns a `frame_ref`; the object gets a `delete_after` from retention config (§12.3) |
| `POST /api/device/scan` | standalone tag reader | action (`lookup`/`stock`/`discard`), tag_id, payload | A reader on a signed-in workstation uses the session instead (§4) |

### 9.3 The signed centre API — `/api/v1/demand`

For an external blood centre that cannot share the database (§5). HMAC-SHA256 over
`timestamp.body` with a per-centre secret; the timestamp is inside the signed payload to prevent
replay, and a `(centre_id, nonce)` table rejects duplicates inside the acceptance window.
`centre_id` is required from day one so multi-tenant is not a retrofit (§13). This is the only
public write surface the system has, and it is off by default behind a feature flag until a
second centre exists.

### 9.4 Public read — the demand board

No account. Group, hospital, town, units outstanding, needed-by, and nothing else (§6). Served
from a query that **cannot** join to patients or requests — it reads `donor_demand` columns
only — cached for 30 seconds, rate-limited by IP. §14 names this as the one page an outsider can
read, so its response shape is pinned by a test that fails if any new column appears.

### 9.5 Chat (Module 3)

Not HTTP on a long-polling channel: the bot pulls updates and the process has no inbound
surface at all (§10). On a webhook channel the bot gains one endpoint with platform signature
verification, replay protection and rate limiting — a change in attack surface significant enough
that §19 keeps it as a decision record rather than a config toggle.

---

## 10. Ports and adapters

Every external dependency, its interface, and what happens when it is down. §10 requires the loop
in §1 to survive each of these being unavailable.

| Port | Interface | Adapter(s) | When it fails |
|---|---|---|---|
| `ChannelPort` | `send_request_card`, `update_card`, `ask_question`, `collect_multi_select`, `request_phone`, `request_location`, `send_notice`, `deep_link` (§2.11) | `telegram`, `whatsapp` | Outbox rows stay `queued` and retry with backoff; nothing is lost, and the "stand-down not sent" alert fires if the backlog ages |
| `EmailPort` | `send(kind, to, templateVersion, vars)` → provider message id | Provider SDK, plus a capture adapter in tests | `email_deliveries` stays `queued`; admin sees delivery status and can re-send an invite (§2.4) |
| `ObjectStoragePort` | `put`, `getStream`, `delete` | S3-compatible | Seal upload fails loudly; existing seals are unreadable but no clinical flow blocks — a request prints without the seal image rather than not printing |
| `GeocodePort` | `reverse(lat, lng)` → four levels, or `null` | Provider, plus a null adapter | Falls through to the type-ahead (§10) — which is why step 8 has two paths |
| `VisionDevicePort` | inbound; the device calls us | — | Camera dark = **no observations**, never zero stock (§2.12). Dashboard shows last-seen; an alert fires on silence |
| `ReaderPort` | inbound scan, or keyboard entry | — | A failed reader degrades to typing the identifier — every scan field has a text fallback (§10, §15) |
| `ClockPort`, `IdPort` | `now()`, `uuid()` | Real, and deterministic fakes | Test infrastructure, not runtime risk |

**The channel port is the model for all of them** (§2.11). Two consequences shape the bot's code
now rather than later: `update_card` is an **optimisation the adapter may decline** — every flow
is written to work when the card is re-sent and the old one marked stale — and every donor-facing
string lives in one resource file, because on WhatsApp those strings are what gets submitted for
template approval weeks before launch (§5, §14).

---

## 11. Background work

Two runners, same shape: a table of jobs, an advisory-locked process, a `FOR UPDATE SKIP LOCKED`
claim, exponential backoff, and every run recorded as a row.

```sql
UPDATE hospital.jobs SET started_at = now(), attempts = attempts + 1
 WHERE id = (SELECT id FROM hospital.jobs
              WHERE status = 'pending' AND run_after <= now()
              ORDER BY run_after LIMIT 1 FOR UPDATE SKIP LOCKED)
RETURNING *;
```

### 11.1 `worker` (web app)

| Job | Cadence | What it does | Spec |
|---|---|---|---|
| `drain-email-outbox` | 15 s | Sends `queued` rows, records provider id, retries with backoff | §2.4 |
| `sync-email-status` | 5 min | Pulls bounce/complaint webhooks or status, updates delivery state | §2.4 |
| `expire-bags` | hourly | `available`/`quarantined` bags past `expires_at` → `expired`; a quarantined bag that expires is discarded with that reason | §4 |
| `escalate-quarantine` | hourly | Quarantined past threshold → surfaced and alerted | §4 |
| `escalate-reconciliations` | hourly | Open reconciliation tasks past threshold → alerted | §4 |
| `camera-silence-check` | 15 min | Registered camera with no observation in N intervals → alerted | §11.9 |
| `flag-stale-invites` | daily | Unactivated accounts past the configured age → surfaced in the admin list | §3 |
| `flag-stale-update-requests` | daily | Pending requests ageing visibly in the queue | §3 |
| `flag-stale-drafts` | daily | Drafts past threshold surfaced to their author — **never auto-deleted** | §3 |
| `expire-demand` | hourly | `date_required` passed on an open demand → `expired`, which the bot's close path picks up | §5 |
| `purge-frames` | daily | Deletes camera frames past `delete_after`, reports what it removed | §12.3 |
| `retention-sweep` | daily | Per-class deletion from §12.3, with a **dry-run mode and a report** | §12.5 |
| `session-otp-cleanup` | hourly | Deletes expired sessions, OTPs and invites — deleted, not merely marked used | §12.3 |

Note what is **not** here: nothing touches `tag_discrepancies`. §4 says a case-3 discrepancy
never auto-resolves and never expires; the absence of a job is how that is implemented, and it
carries a comment saying so.

### 11.2 `bot` ticker

| Job | Cadence | What it does |
|---|---|---|
| `import-demand` | 60 s | `SELECT … WHERE status = 'open' AND bot_public_id IS NULL` → `bot_requests`, idempotent on `demand_id` (§5) |
| `run-waves` | 60 s | `bot_requests WHERE status = 'open' AND next_wave_at <= now()` → §7.7, then set the next wave 30 min out |
| `apply-counter-outcomes` | 60 s | Confirmations the centre has marked → roll interval, thank, close the demand when every unit is in |
| `detect-closures` | 60 s | Demands the centre cancelled, or that expired → §7.6 stand-down fan-out |
| `drain-message-outbox` | 5 s | Sends queued chat messages with retry and dedupe |
| `resume-reminders` | daily | One gentle reminder to an abandoned signup — **once**, then silence (§5) |
| `prune-journey-rows` | daily | Journey rows and event log past retention, once aggregated (§12.3) |

Every cadence is configuration (§12), not a constant.

---

## 12. Configuration

§14 names hard-coded clinical thresholds as a risk, and §12.1 makes it a compliance point:
guidelines are revised, and a code deploy is the wrong way to adopt a new interval. So every one
of these is a row in `app_config`, read through `packages/config` with a Zod schema, a typed
accessor, a 60-second cache, and an audit event on every change.

| Group | Keys | Default |
|---|---|---|
| Donor eligibility | `donor.min_age`, `donor.max_age`, `donor.min_weight_kg`, `donor.interval_days.male`, `donor.interval_days.female` | 18, 65, per guidelines, 90, 120 |
| Waves | `wave.size`, `wave.interval_minutes`, `wave.max_waves` | 20, 30, unbounded |
| Stock | `centre.min_units_per_group`, `product.shelf_life_days.*`, `centre.return_time_limit_minutes` | 25, per product table, from the hospital SOP |
| Vision | `vision.confidence_threshold`, `vision.drift_threshold`, `vision.capture_schedule`, `vision.shadow_mode` | shadow mode **on** by default (§4) |
| Auth | `auth.invite_ttl_hours`, `auth.otp_ttl_minutes`, `auth.otp_max_attempts`, `auth.login_throttle`, `auth.min_password_length` | 24–48, 10, small, per §3, 12 |
| Ageing thresholds | `ageing.quarantine_days`, `ageing.reconciliation_hours`, `ageing.invite_days`, `ageing.draft_days` | tunable per site |
| Retention | `retention.frames_days`, `retention.journey_months`, `retention.donor_tail_days`, … | §12.3 |
| Feature flags | `flag.vision_enabled`, `flag.whatsapp_channel`, `flag.public_board`, `flag.external_demand_api` | off until each is ready (§11.2) |

Three rules: **`packages/domain` never reads config** — thresholds are passed in as parameters,
which is what keeps it pure and testable; the **SQL wave query and the TypeScript predicate read
the same keys** (§7.7); and **shelf lives and the stock floor live in `product_shelf_lives` and
`centre_settings`** because they are edited on the centre settings screen (§15), with
`app_config` holding everything that has no screen.

---

## 13. Security and authorization

**Sessions.** Server-issued cookie: `httpOnly`, `sameSite=lax`, `secure` in production; only the
SHA-256 hash is stored (§3). Passwords are Argon2id. Login and OTP attempts are throttled per IP
and per account **in the database**, so the limit survives a restart and applies across replicas
(§3).

**Authorization at three independent layers** (§3), because no single mistake should grant access:

1. **Route protection** — middleware maps a path prefix to a required role set (`/centre` →
   `blood_centre` or `admin`; `/volunteer` → `volunteer_admin` or `admin`; `/admin` → `admin`).
2. **Page guard** — every server component re-reads the session and re-checks the role before
   rendering.
3. **Use-case check** — every use case takes an `actor` and asserts the permission itself, so a
   job, a script or a future HTTP caller cannot bypass the first two.

Tested as the wrong role, **checking the response body and not just the redirect** (§14) — a
volunteer admin hitting a centre endpoint must get no data, not a 302 with a JSON payload.

**Safeguards enforced in the use case and, where possible, in the schema**: cannot change or
deactivate your own account; cannot approve your own update request (`CHECK`); the last active
admin cannot be demoted or deactivated (row-locked count); duplicate email or registration
number rejected (unique).

**Device tokens** are 256-bit random, shown once, stored hashed, revocable individually, and
scoped to one device row. A revoked token fails closed.

**HMAC** on the external demand API (§9.3): per-centre secret, signature over `timestamp.body`,
±5 minute acceptance window, nonce table for replay.

**Secrets** come from the environment, are validated by a Zod schema at boot (the process refuses
to start on a missing one), and are scanned for on every push (§11.7).

**Data-shape rules that are security controls**: doctor identity, centre user id and donor chat
identity are always read from the authenticated principal on the server and never accepted from
the client (§2.5); seals and frames are served only through authenticated routes, never by public
URL; the public board's query cannot reach a patient column (§9.4).

---

## 14. Observability, audit and errors

**Correlation.** One id is generated at the entry point of every request, chat callback and job,
and travels the whole loop: request → decision → demand → wave → confirmation. It is stored on
`audit_log`, `event_log`, `jobs` and the demand row, so one unit of blood can be followed end to
end (§11.9) with a single query.

**Audit** is written inside the use case, best-effort and non-blocking: an audit failure logs
loudly but must not fail the clinical action (§2.9). The coverage list is §2.9's table, and a test
asserts every mutating use case emits at least one event — a new use case with no audit write
fails CI.

**Logs are structured, and carry no personal or health data** (§11.9): donor ids not names,
request ids not patient names. A lint rule bans logging whole row objects from the tables that
hold names and phone numbers, since that is how PII actually reaches logs.

**Alert on what fails silently** (§11.9): a camera that stopped reporting, a wave that did not
fire (`bot_requests` with `next_wave_at` in the past), an email provider rejecting, a demand
closed with unsent stand-downs (§7.6), reconciliation tasks or quarantined bags ageing past
threshold, jobs failing repeatedly, and outbox backlog.

**Health checks verify the database and the chat platform**, not just process liveness (§11.9).
The bot's diagnostic command (§5) is the same checks, callable from chat, reporting what to do
about each failure.

**The error model** is §3's `Result`. Adapters map error variants to HTTP status codes and to
donor-facing copy in one table per adapter, so a new error variant that nobody mapped is a type
error rather than a 500.

---

## 15. Compliance components

§12.5 lists seven things that are product work rather than paperwork. Their backend shape:

| Requirement | Backend |
|---|---|
| **Grievance contact** | A config-driven contact rendered in the web app, the bot menu and the public board; a `grievances` table recording each contact and its outcome |
| **Versioned privacy notice** | `notice_versions` (version, locale, body, published_at); the version is written into every `donor_consents` row (§5) |
| **Data subject requests** | `data_subject_requests` (subject kind donor/patient, request kind access/export/correction/erasure, status, handled_by, outcome), each with an audited end state |
| **Access/export** | A use case that assembles everything held about one donor or patient into a single JSON export, generated from the schema so a new table cannot be silently omitted |
| **Erasure** | Donor deletion nulls profile, channel, phone, location and screening data and **de-identifies** `donor_demand_confirmations`, keeping the donation and bag identifier (§5). A donor who never donated has nothing retained, and the confirmation message says so |
| **Retention jobs** | §11.1's `retention-sweep`, with a dry-run mode and a report of what it removed (§12.5) |
| **Access review** | A scheduled report of who holds which role, with `last_login_at`, exported and archived as evidence |
| **Record of processing** | Generated from the schema and column comments, so it stays current instead of being written once (§12.5) |
| **Breach runbook** | Detection wired to the §14 alerts; the runbook and templates are documentation, but the detection is code |

Two constraints that are architectural rather than procedural: **the bot must never offer money
or material reward** (§12.1) — there is no incentive field anywhere in the schema and there must
not be one; and **the standard-wording test (§2.7) is a compliance control**, since the disclaimer
in §12.6 depends on the questionnaire never reading as a fitness determination and the camera
never reading as an authority on stock.

---

## 16. Failure and degradation

§10 requires the loop in §1 to keep working when each dependency is down. What each failure
actually does:

| Down | Effect | Loop continues? |
|---|---|---|
| Email provider | Invites, OTPs and outcome mails queue in `email_deliveries` and retry; admin sees status and can re-send | **Yes** — no clinical flow depends on mail |
| Object storage | Seal upload and frame upload fail loudly; existing seals unreadable | **Yes** |
| Geocoder | Location step falls through to the type-ahead (§10) | **Yes** |
| Camera / vision service | No observations, no reconciliation tasks; dashboard shows last-seen and "needs recalibration" | **Yes** — and stock never reads zero because of it (§2.12) |
| Tag reader | Every scan field accepts a typed identifier | **Yes** |
| Chat platform | Cards and notices queue in `message_outbox`; the demand still exists and the roster still works | **Yes**, degraded — the stand-down backlog alert is the thing to watch |
| Bot process | Demand rows accumulate unimported; the centre is unaffected; the ticker catches up on restart because wave timing is a column | **Yes** |
| Worker process | Sweeps and outbox drains stop; nothing is lost, everything is a queued row | **Yes**, degraded |
| Web app | The centre cannot decide; the bot keeps working on demands already imported | **No** for new requests |
| Database | Everything stops. Clinical data is network-only by design (§2.8) and offline calls fail loudly rather than serving stale records | **No** — and that is the intended behaviour |

---

## 17. Testing and CI

The layering in §3 is what makes §11.6's pyramid cheap. Each layer's tests and what they cover:

| Layer | Covers | Infrastructure |
|---|---|---|
| **Domain** | The full ABO/Rh matrix; eligibility at boundary ages, weights and intervals; every state-machine transition **and every illegal one**; expiry arithmetic across month ends and leap years | None — pure functions, milliseconds |
| **Predicate agreement** | The SQL wave query and the TypeScript check agree on a seeded pool spanning every boundary (§7.7) | Real Postgres |
| **Concurrency** | The last-unit race; two staff deciding one request; two counters claiming bags; a replayed callback; a double-scanned tag; two concurrent last-admin demotions | Real Postgres, deliberate interleaving |
| **Contract** | Both sides of §7 against `packages/contract`, run in both codebases; column-grant assertions | Real Postgres |
| **Adapter** | Chat flows against a fake channel (including one that **declines `update_card`**); the device API against recorded observations; email against a capture server | Fakes |
| **Flow** | Every row of §8's flow index, **including the ways out** — the cancelled-demand stand-down first, not last (§14) | App + Postgres |
| **Authorization** | Every surface in §9's role matrix as every role, asserting the **response body** | App |
| **Regression** | Standard clinical wording (§2.7); the public board's exact response shape; retention jobs' dry-run output | Fast |

**CI gates** (§11.7), nothing merges without: typecheck, lint, format, unit + integration tests,
**module boundary check**, migration-applies-cleanly (empty and seeded), contract tests both
sides, dependency vulnerability scan, secret scan, build.

**The rule worth restating**: a bug that reached production gets a test before it gets a fix
(§11.6).

---

## 18. Delivery plan

Ordered so that each phase ends with something demonstrable, and so the highest-consequence paths
are built early rather than last.

**For the current build, [build-plan.md](build-plan.md) supersedes this table.** The phases below
are the spec-shaped order, correct for a team with a pilot ahead of it. The build plan re-sequences
them for the constraints actually in force — a solo greenfield build toward a demonstration
milestone, with hardware arriving mid-build — which means reaching a closing loop early and
deepening afterwards, rather than completing each module in turn.

| Phase | Delivers | Done when |
|---|---|---|
| **0. Foundations** | Monorepo, workspaces, boundary lint, CI gates, Postgres with three schemas and three roles, migration runner, config loader, `Result`, branded ids, test harness | A trivial use case runs end to end and CI blocks a deep import |
| **1. Platform + Module 1 core** | Users, sessions, throttling, invite → set password → signed in, reset OTP, profile, seal to object storage, patients, admissions, drafts, submit with the counter, samples, audit | A doctor can be provisioned by email and submit a request that gets a `BR-` id |
| **2. Account lifecycle completeness** | Update-request queue, re-send invite, delivery status, admin safeguards, stale-invite and stale-draft ageing | Every §8 Module 1 flow reaches a named ending, including the ⚠︎ ones |
| **3. Module 2 — register and decisions** | Tags, bags, intake with derived expiry, the decision transaction, stock floor, `donor_demand` writes, centre settings | Two staff deciding concurrently produce exactly one decision and correct reservations |
| **4. Module 2 — the collision cases** | Return, quarantine with resolution, release/re-register, **case 3 discrepancy with its three resolutions**, discards with disposal route | Each of §8's three case-3 endings is exercised by a test, and no code path can dismiss a discrepancy implicitly |
| **5. Module 3 — donor loop** | Channel port + Telegram adapter, onboarding through step 10 with fix-several, consent recording, demand import, waves, journey, screening, confirm/waitlist, outbox, **stand-down on cancel and expiry** | The cancelled-demand stand-down is demonstrated before the happy path is polished (§14) |
| **6. Contract closure** | Roster marking, walk-ins, counter outcomes flowing back, interval roll-forward, thanks, demand closure all four ways | A request goes from submit to a thanked donor without manual intervention |
| **7. Module 4 + public board** | Group pressure tiles, demands behind a tile, share message, trend, public board with its pinned response shape | Authorization tests pass as every wrong role, body-checked |
| **8. Vision, in shadow** | Device registration, calibration screen backend, observation ingest, reconciliation tasks, drift detection, frame retention — **shadow mode on** | Predictions accumulate beside the register with a labelled set from this fridge; promotion criteria written down in advance (§14) |
| **9. Compliance and operations** | Retention jobs with dry-run, DSR handling, export, grievance, notice versions, record of processing, access review, alerting, runbooks | A retention dry-run reports exactly what it would remove, and an access review exports evidence |
| **10. Second channel** | WhatsApp adapter behind the flag, templates submitted early, `update_card`-declining path exercised | The same flows pass against an adapter that cannot edit a message |

Two sequencing notes worth stating: **WhatsApp templates need submitting during phase 5, not
phase 10** (§14) — the copy is the long pole, not the adapter; and **the vision hardware decision
(one region per group, or a printed marker) must be taken before phase 8 orders anything**,
because it dictates the shelving (§14).

---

## 19. Decisions taken, deviations, and open questions

### 19.1 Decisions this plan takes

Each is expensive to reverse and gets a decision record in `docs/adr/` per §11.8.

| # | Decision | Why |
|---|---|---|
| 1 | **The bot is TypeScript** | Resolves the open decision in §11.3, following its recommendation: one implementation of the clinical rules |
| 2 | **A separate `worker` process** | A stateless, horizontally-scaled web app cannot own a schedule (§10) without firing every sweep N times |
| 3 | **Transactional outbox for chat messages and email** | The stand-down on a cancelled demand is the highest-consequence message in the system (§5); it must survive a chat API failure after commit |
| 4 | **Column-level grants encode §7's ownership** | Makes "written by" a database fact rather than a convention |
| 5 | **The web app holds no grant on the `bot` schema** | Module 4's counters live on `donor_demand`, so the privacy boundary can be a missing grant (§2.10) |
| 6 | **`location_hierarchy` moves to a shared `reference` schema** | Three web surfaces need it, and §11.2 forbids the web app reading a bot table |
| 7 | **`overdue` is derived, not stored** | A stored flag needs a job, and overdue must be true the moment the date passes (§3) |
| 8 | **UUIDv7 keys with a separate human identifier** | Time-ordered index locality without leaking counts |
| 9 | **No Redis; jobs and rate limits live in Postgres** | One fewer dependency, and every job run and throttle window is an auditable row (§3 requires DB-backed throttling anyway) |
| 10 | **Vision holds no database credentials** | §2.12's trust model enforced by absence, not by review |

### 19.2 Deviations from the spec, to be reconciled in the same PR (§11.8)

| Deviation | Spec says | This plan says | Proposed |
|---|---|---|---|
| Location hierarchy ownership | §5 lists it under the bot's data | A shared `reference` schema owned by web migrations | Update §5 and §7's ownership note |
| `tag_discrepancies`, `bag_quarantines`, `bag_discards`, `decision_bags`, `object_refs`, `jobs` | Not in §4's "data it owns" list | Named tables, because the flows in §4 need them to be closable and auditable | Add to §4's list |
| Outbox tables (`message_outbox`, `email_deliveries` as an outbox) | §2.4 requires delivery status; §5 requires closure fan-out | Both are outboxes committed with their cause | Add a line to §2.4 and §5 |

### 19.3 Open questions that need an answer before the phase that depends on them

| # | Question | Blocks | Who answers |
|---|---|---|---|
| 1 | The centre's actual component catalogue — is the five-product list complete, and does it follow ISBT 128 labelling here? (§2.7) | Phase 3 | Blood centre |
| 2 | Shelf life per product, and the hospital's return time limit from its own SOP (§4) | Phase 3/4 | Blood centre in-charge |
| 3 | Statutory retention periods for regulated records and the clinical record (§12.3) ⚖︎ | Phase 9 | Counsel / compliance officer |
| 4 | Consent wording and the erasure carve-out's lawful basis (§5, §12.2) ⚖︎ | Phase 5 | Counsel |
| 5 | Hosting region and cross-border position (§12.4) ⚖︎ | Phase 0 — it is chosen before there is data to migrate | Hospital + counsel |
| 6 | Paediatric patient consent — whose, and evidenced how (§12.2) ⚖︎ | Phase 1 | Counsel |
| 7 | Which chat channel launches, and whether the deployment target can hold a stable public URL (§10) | Phase 5 | Product + ops |
| 8 | Vision hardware: one region per group, or a printed high-contrast marker (§4, §14) | Phase 8, and hardware ordering | Centre + engineering |
| 9 | The source and licence of the seeded Kerala location hierarchy (§5) | Phase 5 | Engineering |
| 10 | Promotion criteria for taking vision out of shadow mode, agreed in writing in advance (§14) | Phase 8 | Centre + engineering |

---

*This plan is part of the specification set. A behaviour change updates the spec and this
document in the same pull request (§11.8).*
