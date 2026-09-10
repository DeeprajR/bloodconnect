# Blood Connect: build plan

A sequenced, solo build of the system in [backend-architecture.md](backend-architecture.md),
greenfield, toward an academic demonstration milestone, with tag readers and the fridge camera
arriving part-way through.

Estimates are in **focused working days**. Days where the build is the only task. At a
realistic solo pace, multiply by roughly 1.5 for calendar time.

## What shaped this plan

| Input | Answer | What it changed |
|---|---|---|
| Existing code | **Greenfield** | Nothing is ported. Phase 0 carries the whole scaffold, and the earlier implementation's divergences (`blood_bank`, PolyForm, local-disk seals) never enter the codebase |
| Team | **Solo** | Strictly sequential. One thing in flight at a time, and the web app and the bot are never open at once. The shared packages land in P0 so neither side needs reworking later |
| Target | **Academic / demo milestone** | The deliverable is **the loop in §1 closing on synthetic data**, so the plan reaches a working loop at day ~29 and deepens afterwards, instead of finishing Module 1 before starting Module 2. Compliance is built but never gated on legal review |
| Hardware | **Arriving mid-build** | Procurement is a calendar track, not an effort track. Every phase before P11 uses the keyboard-entry fallback: which §10 requires anyway, so nothing is throwaway |

**This plan supersedes §18 of the architecture document**, which gives the spec-shaped order
(platform → M1 → M2 → M3 → M4 → vision). That order is correct for a team with a pilot ahead of
it; it is the wrong order for a solo build judged on a demonstration, because it reaches a
visible loop last.

---

## Prerequisites: have these before day 1

Nothing here costs money, and none of it needs a hospital's cooperation.

### Tooling

| Need | Note |
|---|---|
| Node 20+ and pnpm | The workspace root |
| Docker Desktop | Postgres, Mailpit and MinIO all run locally |
| PostgreSQL 16+ image | `FOR UPDATE SKIP LOCKED` and partial unique indexes are load-bearing (§11.3) |
| Git repository | Conventional commits from the first one (§11.8) |

### Services: local stand-ins, deliberately

A demo needs none of the production dependencies, provided each stays behind its port (§10) so
it can be swapped later without touching a use case.

| Dependency | For the demo | Not needed |
|---|---|---|
| Transactional email | **Mailpit** in Docker: a local mail catcher with a web inbox | A verified sending domain, SPF/DKIM/DMARC, a provider account |
| Object storage | **MinIO** in Docker, private bucket | An S3 account |
| Chat channel | **Telegram bot token** from @BotFather: free, takes five minutes, and long-polling means no public URL and no webhook | A WhatsApp Business account or approved templates |
| Reverse geocoding | **Stubbed adapter returning null**: the type-ahead path is the spec's own fallback (§10) and is the path that gets demonstrated | A geocoding provider or API key |

**Get the Telegram token during P0, not P4.** It is the one external thing with a sign-up, it
gates the whole loop, and it takes minutes.

### Data

| Need | For | Scope for a demo |
|---|---|---|
| Kerala location hierarchy | Donor onboarding (P7), patient district, centre settings | **Two or three districts, fully populated down to locality**: enough for the wave ordering to visibly prefer the nearest tier. The full state dataset is not needed to demonstrate proximity |
| Synthetic donors, patients, staff | Every phase from P1 | Seeded, with identifiers that can never collide with real people (§5) |

### Decisions you need to make (not blocking day 1)

| Decision | Needed by | Demo default if unanswered |
|---|---|---|
| The component list: is the five-product set right? (§2.7) | P3 | Use the spec's five, standard names |
| Shelf life per product, return time limit | P3 / P6 | Seed plausible defaults into `product_shelf_lives`; they are configuration, so a later correction is a row, not a deploy |
| **Region-per-blood-group vs printed marker** (§4, §14) | **Before ordering the camera** | Not deferrable: it dictates the shelving. See the procurement track |
| Minimum weight, age bounds, intervals | P4 | National guideline values, seeded as config |

### What you are explicitly not doing

Real patient or donor data, at any point, including "just to test". The demo runs on seeded
records, and that is a property to state on the page, not a limitation to apologise for. The
medical disclaimer (§12.6) stays prominent regardless of the audience.

---

## Shape of the build

```
P0  Foundations                  5d  ✅ ─────────────────────────────────────────
P1  Identity and access, thin    5d  ✅
P2  The request, thin            5d  ✅
P3  The centre decision, thin    6d  ✅
P4  The bot loop, thin           8d  ✅ ▲ MILESTONE A, the loop closes (day ~29)
P5  Module 1 depth               7d  ✅
P6  Centre depth, collisions    8d  ✅
P7  Bot depth, the interview    9d  ✅
P7b The request slip             4d   ⟵ ADR 0010, inserted after P7
P8  Endings sweep                4d  ◐ MILESTONE B, one row short (ADR 0011)
P9  Volunteer + public board     4d
P10 Control panel                5d
P11 Tag reader integration       3d   ⟵ gated on hardware
P12 Vision, shadow mode          8d   ⟵ gated on hardware
P13 Demo readiness               5d   ▲ MILESTONE C, demonstrable (day ~82)
```

Two milestones matter more than the total. **Milestone A is the one that de-risks the project**:
after day ~29 there is a system that demonstrates, and everything after it is depth on something
that already works rather than a bet on integration going well at the end.

---

## The procurement track

Runs on the calendar, not on your effort. Nothing in P0–P9 waits for it.

| Step | When | Note |
|---|---|---|
| **Decide the counting approach** | Before any order | One shelf/tray/bin per blood group and calibrate regions, **or** a printed high-contrast group marker on the tag label. §14 names this as the single most likely reason the vision feature fails, and it dictates the shelving you buy |
| Order readers | Any time; they are the cheaper, lower-risk item | A barcode reader that presents as a keyboard is enough to demonstrate the scan path |
| Order camera + enclosure | After the decision above | Sealed, heated-window, rated for the storage temperature; prefer a wired run (§4) |
| Reader arrives | → **P11**, 3 days | Slots in wherever it lands; the fallback path already works |
| Camera arrives | → **P12**, 8 days | Shadow mode only. Never promoted to raising tasks during a demo |

**If the hardware never arrives, the demo is unaffected.** Typed bag identifiers and "no
observations" are the spec's required degraded modes (§10), not workarounds, so the fallback
path is what you build anyway, and P11/P12 are additive.

---

## Phases

### P0 · Foundations: 5d

**Goal.** A repository where the first real use case can be written without deciding anything
structural, and where CI blocks the mistakes that are expensive to unwind later.

**Build.**
- pnpm workspace per §2; TypeScript `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`.
- Import-boundary lint rule, and a CI job that proves it fails on a deep import.
- Docker Compose: Postgres, Mailpit, MinIO. Three schemas, three roles, the column grants of §5.1.
- Drizzle + the first migration + the seed runner. `db:push` guarded off outside a scratch database.
- `packages/result`, `packages/ids` (UUIDv7, branded), `packages/config` (schema + defaults),
  `packages/testing` (fake clock, db harness).
- `packages/domain`. The rules everything else needs, all pure: **ABO/Rh compatibility matrix**,
  blood groups and products, `BR-YYYY-NNNNNN` formatting, expiry arithmetic, inter-donation
  interval arithmetic, the four state machines as transition tables.
- `packages/contract`. The two shared tables' schemas and transitions, and `CONTRACT_VERSION`.
- Telegram bot token obtained and stored in `.env.example` as a placeholder.

**Prove.** CI runs typecheck, lint, tests, boundary check, migrations-apply-clean, build. The
full 8×8 compatibility matrix is tested. A deep import fails the build.

**Defer.** Every feature. This phase has no UI.

---

### P1 · Identity and access, thin: 5d

**Goal.** Four roles that can sign in, and an authorization model that is right the first time,
because retrofitting three-layer authz across finished screens is far more expensive than
building it once.

**Build.**
- `users`, `sessions`, `auth_rate_limits`; Argon2id; httpOnly session cookie; CSRF same-origin check.
- Seed scripts for all four roles (§2.2 sanctions the seed path; there is no sign-up page).
- The three authorization layers of §13: route guard, page guard, use-case check.
- `audit_log` and the audit writer, wired into the use-case context so later phases get it free.
- `app_config` loader with the clinical defaults.

**Prove.** A test that hits every surface in §9's role matrix as every role and **asserts the
response body, not the redirect** (§14).

**Defer.** Invites, OTP reset, update requests, seals, the admin panel, all P5. For now accounts
come from the seed script.

---

### P2 · The request, thin: 5d

**Goal.** A doctor can put a real blood request into the database and get an ID back.

**Build.** Patients, admissions, draft create/edit, the review screen, submit with the
transactional counter (§7.1), both snapshots frozen at submit, the request view, a minimal
dashboard.

**Prove.** Two concurrent submits get consecutive IDs with no gap. A submitted request is refused
by every draft endpoint. Standard clinical wording pinned by the §2.7 regression test. Write it
now, while the labels are being typed for the first time.

**Defer.** Duplicate-patient warning, samples, draft ageing, cancel, PWA.

---

### P3 · The centre decision, thin: 6d

**Goal.** The centre answers a request from stock, and a shortfall becomes demand. This is the
first half of the loop closing.

**Build.**
- `blood_bags` and `rfid_tags` with **typed entry**, no reader needed, and §10 requires the
  typed path regardless.
- The request queue with stock-on-hand per group.
- **The decision transaction** (§7.2) in full: `FOR UPDATE SKIP LOCKED` oldest-expiry-first, the
  unique constraint on `request_id`, reservation, and the demand insert in the same transaction.
- Stock floor and "recruit for groups below floor". Centre settings, snapshotted onto demands.

**Prove.** Two staff deciding the same request → exactly one decision, the second gets
`RequestAlreadyDecided`. Two decisions for the same group contend on no bag. A shortfall on whole
blood or PRBC always leaves a demand row; platelets, plasma and cryoprecipitate never do.

**Defer.** Returns, quarantine, discards, the three collision cases, the camera, all P6.

---

### P4 · The bot loop, thin: 8d · **Milestone A**

**Goal.** The loop closes. A shortfall recruits a donor, the donor is screened and confirmed, the
counter marks them donated, and the donor is thanked with a next-eligible date.

**Build.**
- The channel port (§2.11) and the Telegram adapter behind it. Nothing above the adapter knows
  the platform.
- **Minimal onboarding**, only what matching needs: phone, name, date of birth, sex, blood
  group, weight band, district. Resumable via `conversation_state`.
- The demand-import ticker (idempotent on `demand_id`), wave selection (§7.7), the request card.
- Accept → six screening questions → confirm, with the **last-unit conditional UPDATE** (§7.3)
  and waitlisting for the loser.
- `message_outbox` and its drain (§7.6).
- **The stand-down on a cancelled demand**. Built and tested in this phase, before the happy
  path is polished (§14 names it the highest-consequence message and the easiest to leave
  unbuilt).
- Counter outcomes flowing back: donated rolls the interval forward, thanks the donor, closes the
  demand when every unit is in.

**Prove.** The stand-down test first. Then the last-unit race with two simultaneous
confirmations, and a replayed callback that is a no-op (§7.4). Then the full loop on seeded data,
end to end, in one run.

**Defer.** The full four-level location, the summary and fix-several flow, self-service, the
demand board, volunteer cards, all P7.

> **Milestone A.** From here the system demonstrates. Everything after this deepens something
> that already works.

---

### P5 · Module 1 depth: 7d

**Goal.** Every Module 1 flow reaches a named ending, including the ones that fire on paths
nobody demonstrates.

**Build.** Invite → set password → **signed in on the dashboard**; OTP reset with identical
responses for unknown addresses; change password; the account update-request queue with its
both-addresses notification; the admin panel with its safeguards; `email_deliveries` as an outbox
draining to Mailpit; seals to MinIO behind an authenticated route; samples; the duplicate-patient
warning; draft ageing on the dashboard; **cancel a submitted request**, which releases bags and
triggers P4's stand-down; the PWA shell with network-only data (§2.8).

**Prove.** The reset flow is not an enumeration oracle. Nobody approves their own update request.
The last active admin cannot be demoted, under two concurrent attempts.

**Since superseded in part.** ADR 0010 removes drafts from the request, and with them draft
ageing and the stale-draft surfacing built here. The duplicate-patient warning is not
deleted but moves to the centre, which now creates patients. Cancellation, the sample and
the request-view work all stand.
---

### P6 · Centre depth: the collision cases: 8d

**Goal.** The part of this system most likely to put the wrong unit into a patient, built with
the care §4 asks for.

**Build.** `resolveTag` classifying into the three cases; **return** with cold-chain bands and a
Quarantine default when unknown; quarantine with a named resolver and ageing escalation;
release → re-register as a **new bag** with its own derived expiry; **case 3 → a discrepancy that
closes exactly three ways**; discards with a disposal route; inventory filters; the expiry sweep.

**Prove.** Each of the three case-3 endings has a test. **No code path resolves a discrepancy
implicitly**, including the expiry job, which must not touch that table. A return never
recalculates expiry. Re-registering leaves the old bag's history intact.

**Done.** All of the above, plus the counter roster and walk-ins. Two things the plan did not
anticipate: the counter now types the group the unit **typed as** (contract 1.1.0), which is the
only thing that can set `blood_group_verified_at` and therefore the only way a bot-registered donor
becomes recruitable at all; and a walk-in is its own table (contract 1.2.0) because the centre holds
no INSERT on the bot's roster. Found by running as `app_web`, not by the suite.
`pnpm smoke:centre` now does that on demand. ([ADR 0008](adr/0008-centre-depth-and-a-grant-that-said-no.md))

---

### P7 · Bot depth: the interview: 9d

**Goal.** The donor experience the spec actually describes, rather than the seven fields matching
needs.

**Build.** The full ten-step interview; the four-level location with the seeded hierarchy subset
and the type-ahead; **the summary and the fix-several checklist**, one implementation, two entry
points (signup and profile edit); consent recorded with wording version and values snapshot;
durable vs per-request screening properly separated; snooze / opt out / **delete with
de-identification**; the demand board for donors who come looking; volunteer admin cards and the
forwardable message; the abandoned-signup reminder, once.

**Prove.** Three ticked fields are fixed in one pass and return to the summary once. An abandoned
signup resumes on the question it stopped at, after a process restart. Deleting a donor who
donated keeps the donation and the bag identifier, and drops the name and number.

---

**Done.** All of it except two things, both named in ADR 0009: reverse geocoding
(the first of §5's two location paths. The second is built, and there is no
adapter providing a location fix to confirm yet), and the volunteer admin cards,
which need a decision about how a staff account is reached on a chat platform and
belong with the volunteer dashboard in P9.

The finding was erasure: §12.1 requires de-identifying the roster and `app_bot`
held no grant to do it, so deletion reported success and changed nothing.
Migration 0016, contract 1.3.0, and `pnpm smoke:bot` to prove it.
([ADR 0009](adr/0009-the-interview-and-an-erasure-that-did-not-land.md))

---

### P7b · The request slip: 4d

**Goal.** Module 1 becomes four fields and an ID; the patient moves to the counter.
[ADR 0010](adr/0010-the-doctor-app-becomes-a-request-slip.md) has the reasoning and the
consequences. Inserted after P7 rather than folded into P8 because it changes the shape of
the request, and every ending in P8 is an ending *of a request*.

**Build.**

1. **Domain and schema.** `urgency` on the request, with the four levels and their derived
   `date_required`; `admission_id` becomes nullable; the ID moves to `DDMMYY-NNNNN` on a
   per-day counter; `draft` leaves the state machine. Offsets and response thresholds into
   `app_config`.
2. **The doctor app.** One screen, group, product, units, urgency, then the ID, shown
   large enough to read aloud. Their own requests with status and answer. Cancel stays.
   Delete: drafts, draft ageing, the review screen, patient and admission entry.
3. **The counter.** Look up by ID with the date prefilled; create or match a patient
   (duplicate warning moves here), admit under an `ip_no`, attach, snapshot. The crossmatch
   sample moves here too.
4. **The queue.** Ordered by urgency, then date, then submission time, with time-since-
   submitted against the per-urgency threshold. The emergency exception, recorded on the
   decision and shown on the request until a patient is attached.

**Prove.** A doctor submits in four taps and reads back an ID. The centre finds that request
by typing five digits. A non-emergency request cannot be reserved against until a patient is
attached. Asserted as a refusal, not a convention. An emergency can, and the request says so
until it is completed. A request nobody ever brings in ages on the queue as *awaiting the
bystander* rather than vanishing.

**Defer.** Notifying a doctor when their request is answered. P8, with the other endings.
Whether `indication` needs to return as a fifth doctor field is ADR 0010's open question and
needs the medical lead, not a commit.

---

### P8 · Endings sweep: 4d · **Milestone B**

**Goal.** Walk §8's flow index row by row and close every ⚠︎ that is still open. This is a phase
rather than a checklist item because these paths never appear in a demo and are therefore the
ones that are quietly missing.

**Build / verify.** Waitlist promotion and stand-down; expired need flagged overdue; abandoned
drafts surfaced, never deleted; unactioned update requests ageing; quarantine and reconciliation
ageing; invites that were never used; the demand that expires unmet.

**Prove.** One test per ⚠︎ row in §8. A demand cannot close without its stand-downs enqueued.

> **Milestone B.** Every flow in the specification has a named ending, and each has a test.

**Reached.** It was one flow short at the end of the sweep: the account update-request flow had
never been built, P5 listed it and it did not happen, so its ⚠︎ ending could not be closed,
because the flow had no beginning either. Recorded in
[ADR 0011](adr/0011-the-endings-sweep-and-one-milestone-short.md) rather than counted as done,
then built in [ADR 0012](adr/0012-the-update-queue-holds-two-fields.md): the profile action, the
admin queue with approve and reject, the system applying the change itself, and the ageing that
is the ⚠︎. It holds two fields rather than the three §3 listed. The email address keeps its
own flow, confirmed from the new address, which proves more than an approval can.

Two endings were genuinely missing and are now built: declining the acknowledgement leaves a
donor **registered and dormant** rather than nothing at all, and somebody still holding a card
for a request that has filled is told it is covered, at the moment it fills, not hours later
when it closes.

---

### P9 · Volunteer dashboard and the public board: 4d

**Build.** Eight pressure tiles with colour **and** number **and** label (§6, never colour
alone); demands behind a tile; the generated share message; the light trend; district scoping;
the public board.

**Prove.** Every wrong role gets no data in the body. The public board's response shape is pinned
by a test that fails if any new column appears (§14).

**Built** as `packages/volunteer`, a module rather than a folder of queries, and recorded in
[ADR 0013](adr/0013-the-volunteer-board-cannot-see-a-person.md). §6 lists four kinds of person
this surface must never show, and each of them is a table, so the guarantee is mechanical: the
package may import only `platform` and `domain`, and a boundary test reads its own source and
fails on the name of any table holding a patient, a doctor, a donor or a bag. It learns the
shelf is low from the centre's own `stock_floor` demand rather than by counting inventory it
cannot see. The public board stays behind `flag.public_board`.

---

### P10 · Control panel: 5d

**Goal.** One screen an operator can open at 3am and know, without asking anyone, whether the
system is working, and if it is not, which part.

§11.9 already names what to alert on and §14 says the correlation id spans request → decision →
demand → wave → confirmation. Neither has a surface. This is that surface, and it is deliberately
sequenced **after** the loop rather than before it: a health board built before there is anything
to be unhealthy shows green because nothing runs, which is worse than no board.

**Who it is for.** The blood centre in-charge and whoever operates the deployment. It is
administrator-only, lives in the administration application (§1), and holds **no clinical
function**. It can read that a demand is stuck; it cannot answer a request.

**Build.**

- **Health, not liveness** (§11.9). Each dependency checked by doing its actual job, not by
  pinging it: a database round trip, an SMTP handshake, an object-storage `HEAD`, a Telegram
  `getMe`, and the contract-version assertion both processes make at boot (§6). Each reports
  ok / degraded / down, its last check, its latency, **and what to do about it**. A red tile that
  does not say what broke is a pager that wakes someone up for nothing.
- **The silent-failure board**, which is §11.9's alert list made visible rather than emailed:
  demands closed with unsent stand-downs (§7.6), waves that did not fire (`next_wave_at` in the
  past), outbox backlog and age, `email_deliveries` stuck or rejecting, jobs failing repeatedly,
  quarantined bags and reconciliation tasks past their ageing threshold, cameras that stopped
  reporting. Each row links to the record, so the panel is a way in rather than a dead end.
- **Metrics, granular.** Counters and latency per surface, the staff app, the admin app,
  `/api/device/*`, the signed demand API, the chat adapter, with error rate, p50/p95, and volume
  over a window. Per **route and status class**, because "the API is slow" and "one route 500s for
  one role" need different answers. Sourced from a request-scoped middleware that records what it
  already has (§14's correlation id), not from a new agent.
- **Follow one unit of blood end to end.** Paste a correlation id, a `BR-YYYY-NNNNNN`, or a demand
  id and get the whole chain, request, decision, bags issued, demand, waves, confirmations, from
  `audit_log`, `event_log` and `jobs`. §14 says one query should do this; this is the screen that
  proves it can.
- **Configuration and versions**, read-only: the resolved `app_config` with which values are
  overridden and which are defaults (§12), the contract version each process compiled against, the
  applied migration list, and the build identifier. "Which config is this deployment actually
  running" is the first question of most incidents.
- `/api/health` for a load balancer, shallow, unauthenticated, no detail, kept separate from the
  panel, which is authenticated and detailed. A public endpoint that enumerates dependencies is a
  reconnaissance endpoint.

**Prove.**

- Stopping Mailpit, MinIO and Postgres in turn each turns exactly one tile red, with a message
  naming the dependency. Asserted by a test that stops the container, not by inspection.
- **No personal or health data anywhere on the panel or in its logs** (§11.9, §12): donor ids not
  names, request ids not patient names. Asserted by a test that inspects the response body against
  the name and phone columns, in the same shape as the volunteer dashboard's check (§14).
- Every role that is not `admin` gets nothing in the body, not merely a redirect (§9's matrix).
- The trace screen is audited by subject id, like every other read that can reach a record.

**Defer.** Alert *delivery*. Email or chat on threshold breach. The board makes the state visible;
routing it to a person is a deployment decision that needs somewhere to send it, and a demo has
nobody on call. Long-horizon metric storage is also out: a rolling window in the database is
enough to answer "is it broken now", and anything longer wants a time-series store this deployment
does not have.

**Why 5 days and not 2.** The tiles are quick. The metrics middleware, the trace query across
three append-only tables, and the container-stopping tests are not, and without the last one the
panel is decoration.

**Built** as `packages/ops`, recorded in
[ADR 0014](adr/0014-the-control-panel-and-what-it-cannot-see.md). Most of its design follows from
one constraint: `app_web` holds no grant on the `bot` schema, so four of §11.9's alerts were
unreachable. The bot publishes them onto `hospital.process_health` instead, which makes a third
shared table and takes the contract to 1.3.0. The container-stopping test earned its place
immediately: the storage tile was green with MinIO stopped, because it was built on `get`, which
swallows every error by design. Next's proxy cannot observe a downstream status, so metrics are
taken where the status is known rather than timed in middleware and called latency.

---

### P11 · Tag reader integration: 3d · *gated on hardware*

**Build.** The reader endpoint with a device token, scan-to-resolve on the intake screen, and the
label print path if a printer arrives with it.

**Prove.** Pulling the reader mid-flow degrades to typing, with no dead end.

---

### P12 · Vision, shadow mode: 8d · *gated on hardware*

**Build.** Device registration with a token shown once; the calibration screen's backend
(regions, versioning, reference frame); the Python service; observation ingest with the
confidence threshold recording "no observation" rather than zero; reconciliation tasks; drift
detection against the reference frame; frame retention in days.

**Prove.** Vision writes nothing to the register, asserted by a test and by the service holding
no database credentials. A low-confidence capture never reads as zero stock.

**Stays in shadow mode for the demo.** Promotion needs evidence and agreed criteria (§14), which
a demonstration timeline cannot produce honestly.

---

### P13 · Demo readiness: 5d · **Milestone C**

**Build.** The synthetic dataset. Staff, patients, admissions, a stocked fridge, a donor pool
spread across localities so wave ordering is visible; a one-command bring-up; the scripted
walkthrough below; README and install path; **Apache-2.0 licence and NOTICE** (§12.7); the
medical disclaimer where it is actually read; health checks; the bot's diagnostic command.

**The walkthrough to script**, because it is the loop and it is what gets watched:

1. Doctor submits a request for 4 units of PRBC, O− → gets `BR-2026-000142`.
2. Centre decides it: 1 unit on the shelf, oldest expiry auto-selected, 3 short → demand raised
   in the same transaction.
3. Bot's ticker imports it; wave one reaches the nearest locality first.
4. A donor accepts, screens, confirms → is told the hospital and time.
5. **Cancel the request.** Every confirmed donor is stood down immediately. Show this. It is the
   thing most systems of this kind get wrong.
6. Re-raise, confirm, mark Donated at the counter → interval rolls forward, donor is thanked with
   a next-eligible date, demand closes.

---

## The cut line

If time runs short, this is what to drop and in what order. Decided now, calmly, rather than in
the last week.

| Cut | Cost | Keep instead |
|---|---|---|
| P12 vision | The camera half of §4 | Say plainly it is shadow-mode-only by design and not demonstrated |
| P11 reader | Nothing visible | The typed path is spec-required and complete |
| P9 volunteer dashboard | Module 4 | The public board alone, which is cheaper and shows the same data |
| P10 control panel, all but the health tiles | The metrics and the trace screen | Keep the dependency health checks: they are ten lines and they answer the question a demo audience actually asks when something stalls |
| P7 bot depth | The interview quality | P4's minimal onboarding still closes the loop |

**P0–P4 plus P13 is a complete demonstration of the loop in about 38 days.** Everything else is
depth. Do not cut P8. A system full of flows with no endings is the failure mode §8 exists to
prevent, and it is visible to anyone who looks past the happy path.

---

## Standing rules for a solo build

- **One thing in flight.** Finish a phase before opening the next. The temptation to jump to the
  bot while the centre is half-done is what produces two half-systems.
- **Write the concurrency test when you write the transaction**, not later. You cannot click your
  way to a race condition, and §7's seven transactions are where correctness actually lives.
- **Seed before UI.** Every phase starts by extending the seed script, so there is data to build
  against and the demo dataset grows continuously instead of being invented in P13.
- **The domain package is the only place a rule lives.** The moment an eligibility check or a
  compatibility test appears in a route handler, it will diverge.
- **Keep a decisions log** as you go (`docs/adr/`). §11.8 asks for it, and solo work is where the
  reasoning is most likely to exist only in your head.
- **A behaviour change updates the spec in the same commit** (§11.8), including this plan.
- **Timebox spikes.** The vision model and the Telegram adapter both invite a week of tinkering
  that the plan does not have.

---

## Risks specific to this plan

| Risk | Why it applies here | Mitigation |
|---|---|---|
| P4 slips and the loop never closes | It is the widest phase and the first integration point | Its scope is already minimal; if it slips, cut the interview further (drop weight and screening to P7) rather than cutting the stand-down |
| Hardware arrives late, or wrong | Ordered mid-build, and the camera decision dictates shelving | The fallback paths are the spec's own; P11/P12 are additive and cuttable |
| The demo is judged on the happy path, so the ⚠︎ endings feel optional | They are invisible until they fail | P8 is a phase with a milestone attached, not a cleanup task |
| Solo review blindness | No second reader on any commit | The CI gates are the reviewer: boundary checks, contract tests, the wording regression, the role matrix |
| Scope creep from the spec's depth | The specification describes a production system; this is a demonstration of it | The cut line above is decided in advance |

---

*Companion to [backend-architecture.md](backend-architecture.md), which says what is built; this
document says in what order and by when.*
