# ADR 0009 — The interview, and an erasure that did not land

Date: 2026-09-09 · Status: accepted

Phase 7 of the build plan: the donor experience §5 actually describes, rather
than the seven fields matching needed. Ten steps, the summary and its fix flow,
the four-level location, self-service, the demand board.

---

## 1. Two screenings, and why they may not share a namespace

§5 asks the same-looking question twice and means something different each time:

| | Durable — at signup | Visit — at each request |
|---|---|---|
| Asks about | What does not change week to week | What changes today |
| A disqualifying answer | Flags the profile; not matched until resolved | Defers from **this request only** |
| Why | Re-asking reads as distrust | The answer is only meaningful today |

Getting this wrong is not a tidiness problem. A visit answer stored as durable
defers somebody for a year for having skipped breakfast; a durable question
asked at every request tells a donor with a heart condition, eleven times, that
nobody was listening.

So the separation is now **structural rather than intentional**: the journey has
no code that could write to `donor_screening_answers` at all. Both call sites
were deleted rather than made conditional.

The two sets also do not share a callback prefix any more. They did for an hour,
and the router — which claims `screen:` for the journey — swallowed every signup
answer and replied "please answer yes or no" to a donor who had. The durable set
uses `durable:`.

## 2. The summary is the pivot, and the fix flow is the feature

§5 spends a page on this and it earns it: *"If someone got three answers wrong,
they should fix three answers once, not make three round trips."*

One list — `INTERVIEW_STEPS` — is the order the questions are asked, the order
they appear on the summary, and the order a fix queue walks. A second ordering
would have drifted from the first within a month.

The navigation rule is one function. `afterStep` prefers the fix queue over the
natural order, so "walk only the ticked fields, in summary order, and come back
**once**" falls out rather than being three special cases per entry point. That
is also why the profile editor is not a second screen: it is the same summary
over a draft read back from the stored profile, and every prompt and every fix
path is the one signup already uses.

**Nothing is committed until the acknowledgement.** Edits accumulate on the
draft, so abandoning a fix leaves the donor exactly where they were.

## 3. Erasure reported success and did nothing

§12.1 requires that deletion **de-identifies** `donor_demand_confirmations`,
keeping the donation and the bag identifier. The bot could not. `app_bot` held
`UPDATE (status, acknowledged_at, updated_at)` on that table and nothing else,
so a donor who asked to be deleted kept their name and phone number on every
roster row they had ever appeared on, for ever. The code ran without error and
the donor was told it was done.

Migration 0016 grants exactly two more columns — `donor_name`, `donor_phone` —
and no others. The bot still cannot invent a roster row, cannot change what the
counter recorded, and cannot touch the unit number, the date or the typed group:
that is the donation record, and it is the centre's to keep. Contract **1.3.0**.

The grant goes to the bot rather than the centre because the centre has no way
to know a bot donor asked to be erased, and the donor id in that table is the
bot's internal one (§2.11).

`pnpm smoke:bot` is new and is what proves it, by running the interview, the
profile edit and the erasure as `app_bot` and then asserting the six things that
role must **not** be able to do. `TEST_DATABASE_URL` connects as `migrator`, so
the suite could not have caught this — the third time that gap has produced a
bug (ADR 0005, ADR 0008).

## 4. A reminder that depended on the time of day

The abandoned-signup nudge is sent once, and once is enforced by the outbox's
unique `dedupe_key` rather than by a `reminded_at` column — a second source of
truth for the same fact, which a crash between the update and the send could
desynchronise.

Finding *which* drafts are idle was subtler. The first version compared
`conversation_state.updated_at` — stamped by a database trigger on the server's
clock — against a cutoff derived from the **injected** clock. It passed at half
past three and failed at five. Idleness now reads `expires_at`, which the
application writes as `now + TTL` on the injected clock, so "untouched for six
hours" means "the expiry is now less than TTL − 6 away" and the answer does not
depend on what time it happens to be.

§3 injects the clock precisely so behaviour is asserted rather than waited for.
Mixing the two clocks in one comparison quietly gives that up.

## 5. The phone is the one step that needed a port change

§5 makes step 1 *"ask the platform for the contact"*, and the reason is not
convenience: a number the platform vouches for is one the counter can ring,
and until now every registration produced an unverified one — which the roster
rendered as the literal string "not verified" beside the donor's name.

`OutgoingMessage.requestContact` is a hint, not a new port operation: an adapter
whose platform cannot share contacts ignores it, and the flow falls back to
typing in the same breath rather than as a second screen. Telegram renders it as
a reply keyboard, which is why a message with no choices now clears that
keyboard — otherwise the button sits under every later message inviting a second
tap.

## 6. Deltas and open questions

- **Last donation is asked in buckets**, with an exact date accepted if typed.
  Each bucket resolves to its **most recent** day, because assuming somebody gave
  more recently than they did only ever delays their next donation — the safe
  direction, and the same choice §12 makes for the unspecified interval. The cost
  is real: a donor who gave 89 days ago and picks "within 3 months" waits an extra
  three. Worth revisiting if the centre would rather ask month and year.
- **Reverse geocoding is not built.** §5 offers "from their location" as the
  first of two paths; only the second — district, then a type-ahead scoped to the
  level above — exists. The dataset would support the first, but confirming a
  reverse-geocode is a screen that has no value until there is a location fix to
  confirm, and no adapter provides one yet.
- **Volunteer admin cards** (§5, "every volunteer admin gets a card with a live
  counter and a forwardable message") are not built. Volunteer admins are platform
  users with no bot channel, so this needs a decision about how a staff account is
  reached on a chat platform — which belongs with the volunteer dashboard in P9
  rather than being guessed at here.
- **The outbox is the reminder's memory.** If a retention job ever deletes sent
  rows, a donor whose draft is somehow still alive could be nudged a second time.
  Retention is configured (§12) but not yet implemented; whoever builds it should
  exclude `signup_reminder` or accept that.
