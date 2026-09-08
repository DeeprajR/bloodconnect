# ADR 0006 — The bot loop, and the clock that was in two places

Date: 2026-09-08 · Status: accepted

Phase 4 of the build plan. **Milestone A: the loop in §1 closes.** A shortfall
recruits real donors, a donor is screened and confirmed, the counter marks them
donated, and the donor is thanked with a next-eligible date — with every donor
still holding a place stood down when the request ends.

Verified end to end against real Postgres, across both database roles:

```
BR-2026-000010: 2 units of whole blood, AB−
  centre issues 0 of 2          → demand for 2 raised in the same transaction
  bot imports it                → BC-… deep link written back
  7 donors asked, nearest first
  one accepts, screens, confirms → roster row reaches the counter
  counter marks Donated          → interval to 2026-12-07, donor thanked
  ward cancels                   → 6 donors stood down, none left unsent
```

---

## 1. The stand-down was built first, on purpose

§14 names "a demand closed without its stand-down messages sent" as the failure
this system must not have, and the build plan says to test it before polishing
the happy path. That order was kept: `loop.test.ts` opens with six stand-down
tests, written before a single donor could confirm.

**The messages are never sent inside the closing transaction.** A chat API
timeout after the commit would lose them silently — the demand shows closed, the
donors are still expecting to give blood, and nothing anywhere records that they
were never told. So the closure inserts rows into `message_outbox` in the same
transaction, and a separate drain sends them with retries.

Three properties that fall out, each with a test:

- **A replayed closure writes nothing.** `dedupe_key` is built from the ids
  involved, never a timestamp.
- **Someone who declined is not stood down.** They are not waiting for anything,
  and messaging them about a request they already turned down is noise.
- **A block is abandoned, not retried forever.** The adapter distinguishes 403
  from 429, and retrying an undeliverable message buries the ones that could go
  out.

The §11.9 alert is a query — `countStuckStandDowns` — because a demand that
failed to stand its donors down looks exactly like one that succeeded.

---

## 2. Two bugs from one root: time in two places

Both of these passed every unit test and failed the first time the loop ran.

**`enqueue` let the database stamp `next_attempt_at` and `created_at`, while the
drain read the injected clock.** Under a frozen clock nothing is ever due, so the
queue silently stopped — and the §11.9 alert, comparing a database-stamped
`created_at` against the injected clock, reported zero stuck messages while
messages were stuck. The fix is that the caller passes `now` and the rows are
stamped from it. §3 injects time precisely so the two cannot drift apart; taking
a default from `now()` quietly undoes that.

**`findRequestsDueAWave` interpolated a JavaScript `Date` into a raw `sql`
template**, which the driver cannot bind. Every use case passed because every
test called them directly — nothing ran the poll the *process* runs. Fixed with
Drizzle's typed `lte()`, and `ticker.test.ts` now exists for exactly that gap: a
suite that never exercises the caller proves the callee and nothing else.

This is the same shape as the session-expiry bug in P1. The rule earned twice
over: **a `Date` never goes into a `sql` template, and a timestamp is never
defaulted by the database on a row the application will compare against its own
clock.**

---

## 3. The deep-link id was derived from a timestamp

`makePublicId` read the **first** six characters of a UUIDv7 — which are a
millisecond timestamp. Two demands imported in the same second produced the same
`BC-` code, and the unique index refused the second import.

It matters more than a collision usually would: this is the only identifier of a
request that leaves the system. It goes in a URL, into a message, and sometimes
out of somebody's mouth, and two requests sharing one would send donors to the
wrong demand.

Fixed by deriving from the **trailing** characters, which are the random ones,
and `public-id.test.ts` mints a thousand ids as fast as possible — the thing a
batch import does, and the thing a test generating one id at a time never does.

Import is also now per-demand try/catch: one demand that cannot be imported must
not stop every other open demand being recruited for. The claim and the insert
roll back together, so the next pass retries with a fresh identifier.

---

## 4. Order in the ticker is a design decision, not an implementation detail

```
cancellations → import → expiries → waves → outcomes → waitlist → completions
              → write-back → drain
```

**Cancellations first**: a demand the centre withdrew has donors holding places
for it right now, and every tick they are not told is a tick somebody might set
out for the hospital.

**Expiries after the import, before the waves.** This was wrong first: a demand
can arrive already past the day the blood was needed — raised late, or left
unimported while the bot was down. Expiring before the import missed it and then
waved it, asking real people to give blood for a request that had already
passed.

**The drain last**, so everything queued during the pass goes out in the same
pass.

---

## 5. Decisions taken

| Decision | Why |
|---|---|
| **`packages/bot` is a package; `apps/bot` is the process** | Same shape as `platform`/`hospital`/`centre`. The process holds the two loops and the signal handling; every rule is in the package and testable without one |
| **The in-memory channel is not a test double** | §10 requires the system to be demonstrable when the chat platform is unreachable, and running with no token is exactly that. It is also what makes a fresh clone runnable before anyone has spoken to @BotFather |
| **Replies go through the outbox, not inline** | Ordering. A reply sent inline while the outbox holds a stand-down arrives after it, and "you are confirmed" landing after "you are no longer needed" is the pair a donor would act on |
| **The drain claims with a lease, not a status** | A `sending` status needs a crash-recovery sweep to release rows a dead process was holding. A lease releases itself, and `dedupe_key` makes the one duplicate send harmless |
| **Only flagging, durable screening answers reach the profile** | "No, I have never had hepatitis" is a health datum that changes nothing, and §2.10 says not to store it. A temporary answer stored as durable would defer somebody permanently for having skipped breakfast |
| **A permanent deferral sets a flag, not a rejection** | The person is not asked again about something they cannot change. Being asked repeatedly would be worse than not being asked |
| **Deletion de-identifies rather than deletes** | A donation record the centre is required to keep must survive, and it must survive without the person's name attached. Said plainly *before* it happens, in one sentence (§5) |
| **The bot gets `SELECT` on `hospital.app_config`** | §12 requires the SQL wave query and the TypeScript predicate to read the same thresholds, and they live in different processes. SELECT only: shortening an interval is the one edit that could physically harm somebody |

### The predicate that exists twice

§7.7's wave query is SQL and `isEligible` is TypeScript, and §11.3 makes the
agreement test mandatory. `loop.test.ts` seeds a donor on every boundary —
exactly the minimum age, one day short, exactly the maximum age, one day past,
exactly at the weight threshold, one kilo under, eligible today, tomorrow,
yesterday, plus every exclusion — runs both readings and asserts the sets are
identical.

The age bounds took two attempts. `date - interval + 1` is not valid SQL at all
(`date - interval` is a timestamp, and adding an integer to one is an error), and
the birthdays have to be exact years rather than `n * 365` days — a boundary test
that is six days out tests nothing.

---

## 6. The privacy boundary, checked from both sides

§5.1's boundary is a missing grant, not a convention, and the suite proves it by
connecting as each role:

- `app_bot` cannot read `hospital.patients` or `hospital.blood_bags`.
- `app_web` cannot read `bot.donors` or `bot.donor_phones` — the centre sees a
  donor's name on the roster row it was given, and nowhere else.
- `app_bot` holds no UPDATE or DELETE on `bot.event_log`.

It caught a real mistake while this phase was being verified: a scratch query
joined `bot.donors` to `hospital.blood_bags` and was refused outright. Neither
role can see both, which is the point.

The event log is asserted to contain **no name, no phone number and no screening
answer** — donor ids and question keys only. The log outlives the incident it
documents, and a name in it is a name with a long tail.

---

## 7. What is deferred, and named as deferred

P7 has the interview depth: the four-level location with the type-ahead, the
summary-and-fix-several flow, the locality review queue, self-service profile
edits, admin cards. P9 has the demand board and volunteer cards.

## 8. The first live connection, and what it found

A real token went in and the adapter connected on the first attempt —
`getMe` returning `@cmck_blood_donor_bot`. Two things came out of that ten
seconds, and both were real:

**`CHANNEL` had been set to the bot's @username.** That variable names the
*platform* and is stored in `donor_channels.channel`; the username belongs in
`TELEGRAM_BOT_USERNAME` and appears only in deep links. The process accepted it
silently, because anything that was not `memory` fell through to Telegram — so a
value that configured nothing looked like it configured something. It now
refuses to start on an unrecognised channel (§13).

**The outbox drain ignored the channel on the row.** It sent every message
through the one adapter the process was polling, so a message queued for one
platform would go out on another — to a stranger, or to nobody. §2.11 stores a
channel per donor *and* per queued message precisely because both kinds of row
can be in the queue at once, so delivery is a lookup: `ChannelRegistry`, and a
row for a platform this process is not running is left **pending** rather than
abandoned. The message is fine; the platform is simply elsewhere.

Neither was reachable from the in-memory channel, because with one adapter
running, routing to it is always right. The lesson is the one this phase keeps
teaching: **a second real thing is what makes the first one's assumptions
visible.**

## 9. Still not exercised

A live **send**. `getMe` proves the token and the transport; nothing has yet
been delivered to a person, because that needs somebody to message the bot.

And a donor registering through Telegram is **not selectable into a wave**:
`blood_group_verified_at` is null until the centre confirms the group, and
§7.7 requires it — recruiting on a self-declared group sends the wrong person to
the counter. There is no screen that sets it yet; that belongs with the counter
work in P6. Until then it is a database row, and the gap is named rather than
papered over.
