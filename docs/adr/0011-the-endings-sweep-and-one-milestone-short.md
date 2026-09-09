# ADR 0011 — The endings sweep, and one row short of Milestone B

Date: 2026-09-10 · Status: accepted

Phase 8: walk §8's flow index row by row and close every ⚠︎ still open. The
phase exists because these paths never appear in a demo and are therefore the
ones quietly missing.

The sweep found fewer gaps than expected and one that is bigger than a gap.

---

## 1. What was already there

Most ⚠︎ rows were built and had tests, which is what the phases before this were
for. Audited against the code rather than assumed:

| Row | State |
|---|---|
| Never-activated invite ages in the admin list | Built (P5), shown with its age in days |
| OTP expired or exhausted → retry | Built — the message says "start the reset again", and both forms are on one page, so step one is already in front of them |
| Cancelled by the doctor | Built (P5) |
| Need date passes undecided → overdue | Built, and now joined by the per-urgency response clock (ADR 0010) |
| Case 3 discrepancy, three endings | Built (P6), each requiring a person, a finding and a note |
| Quarantine must resolve | Built (P6), with ageing and automatic discard at expiry |
| Waitlist promoted / stood down | Built (P4) |
| Demand cancelled or expired → stood down | Built (P4), and the reason the outbox exists |
| Abandoned signup → one reminder | Built (P7), once by the outbox's dedupe key |
| Deletion with de-identification | Built (P7), reaching the roster since migration 0016 |

## 2. Two endings that were genuinely missing

**"Not now" had no button.** §5 is explicit that declining the acknowledgement
leaves the registration *kept but dormant*, and reversible — "a donor who says
'not now' has not said 'delete me', and making them retype everything if they
change their mind loses them twice". The type carried a `declined` case that
nothing produced, and the summary offered two choices where the spec describes
three.

Dormant is now expressed with the same field everything else reads:
`consent_current_at` is left null, and §7.7 recruits nobody whose consent is not
current. A second flag meaning "dormant" could have disagreed with the wave
query; this cannot. There is no consent row either, because they did not consent
— a record of a refusal in the table that is the evidence of consent would give
the wrong answer to the first person who queried it.

**Nobody was told when a request filled without them.** §8 asks for one line —
it is covered, thank you, nothing to do — and the card stopping offering Accept.
What existed was the stand-down at *closure*, which is a different moment and can
be hours later. In between, a donor held a live card for a request that no longer
needed them, and tapping it would have put them on a waiting list they never
asked to join.

`tellUnansweredItIsCovered` runs on the ticker, after the waitlist promotions —
telling somebody it is covered and then promoting them would be two contradictory
messages in one tick. It moves the journey to `CANCELLED` in the same transaction
as the message, which is also what stops a later closure telling them a second
thing: `CANCELLED` is not in `STANDS_DOWN_ON_CLOSURE`.

## 3. A row that no longer exists

"Draft abandoned → ages on the dashboard, never auto-deleted" describes a state
ADR 0010 removed. A four-field form is submitted or it never existed.

It is not simply deleted from §8, because the failure it guarded against is real
and moved rather than vanished: a request nobody follows up. That is now **the ID
nobody brings to the counter**, and it ages on the centre queue as *awaiting the
bystander* instead. §8 says so in its place.

## 4. Milestone B is one row short, and it is not this phase's row

> **Account update request** — *Request update* on the profile page → approved
> and applied · rejected with a reason · withdrawn · ⚠︎ untouched → ages visibly
> in the admin queue.

**The whole flow was never built.** Not the ending — the feature. P5's plan
listed "the account update-request queue with its both-addresses notification"
and it did not get built; `account_update_requests` exists as a table and is
referenced by nothing. There is no *Request update* action on the profile page
and no queue in the admin app.

P8's mandate is to close endings on flows that exist, and manufacturing a
feature inside a sweep phase is how a sweep phase stops being one. So it is
recorded here rather than quietly counted as done:

**Milestone B — "every flow in the specification has a named ending, and each
has a test" — is met for every flow except this one, which has no beginning
either.** Closing it is roughly a day: the profile action, the admin queue with
approve and reject, the system applying the change rather than an admin retyping
it, both-addresses notification on an email change, and the ageing that is the
⚠︎ itself.

Two safeguards from §3 come with it and are the reason it is not a small job:
nobody may approve their own request, and an approved email change must
invalidate any outstanding OTP.

## 5. Still open

- ~~The account update-request flow above.~~ Built in ADR 0012, which also
  records why it holds two fields rather than the three §3 listed.
- The centre's request queue shows a request awaiting a bystander and ages it,
  but nothing yet *closes* one that never gets collected. §8 says the centre
  closes it with that reason; today it would sit on the queue indefinitely. It
  is an ending with a screen and no button.
- Camera calibration drift and the reconciliation task are ⚠︎ rows gated on
  hardware (P12), and are not counted against Milestone B here.
