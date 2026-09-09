# ADR 0012 — The update queue holds two fields, not three

Date: 2026-09-10 · Status: accepted

Closes the last row of Milestone B, recorded as open in ADR 0011 §4: the account
update-request flow, which had no ending because it had no beginning.

---

## 1. Email does not go through the queue

§3 lists three fields a user must not silently rewrite: email address, display
name, provisional registration number. Building the queue for all three would
have been the literal reading, and it would have been wrong.

Migration 0005 already gave the email address its own flow. The person types the
new address, a link goes to *that* address, and the change applies when they open
it. The old address is told at the same time, so an unauthorised change is
visible to the person about to lose the account rather than silent.

That flow proves something the queue cannot: that the person actually holds the
address. An administrator approving an email change proves only that an
administrator agreed — and an administrator can be mistaken, rushed, or the
attacker. Adding the queue as a second path to the same change would mean the
account's identity could move by the weaker of the two, which is the one anybody
attacking it would choose.

So the queue covers the two fields nothing can verify by delivery:

| Field | Why it is reviewed |
|---|---|
| `full_name` | Printed on every request the doctor raises, and from there onto the clinical record |
| `provisional_reg` | The same, and unique across accounts — two doctors cannot hold one number |

§3 and the risk register in §12 now say this rather than the three-field version.

## 2. The system applies the change

An approval that told an administrator to go and retype the value somewhere else
would be a second chance to get it wrong, against a queue that would afterwards
say it went right. `approveUpdateRequest` writes the field itself, in the same
transaction as the decision, so what was reviewed is exactly what lands.

The row stores `current_value` as it stood when the request was raised, rather
than joining to the account at review time. Without it, a value edited in between
would make the queue display a comparison nobody submitted.

## 3. Nobody decides their own

The queue exists so that a second person agrees. An administrator approving their
own request has removed the only check in the flow, so `approveUpdateRequest` and
`rejectUpdateRequest` both refuse it — rejection included, because otherwise an
administrator could quietly bury a request against themselves.

It is refused in the use case rather than in the database: Postgres sees two
uuids and cannot know that their being equal is the point. The row records
`decided_by` regardless, so a decision is attributable afterwards either way.

The administration page hides the buttons as well as the use case refusing them.
A button that always fails has told the person nothing about why.

## 4. The ⚠︎ is the ageing

§8's warning on this row is *untouched → ages visibly in the admin queue*. The
failure being guarded against is not rejection, it is silence — a request that
sits for a fortnight because nobody looked.

So the queue is ordered oldest first, and each card says how many days it has
waited in words rather than as a date. Reading a date requires arithmetic, and
nobody does the arithmetic. Past a week it is shown in the danger style.

## 5. One pending request per field, enforced by the index

A partial unique index on `(user_id, field) WHERE status = 'pending'`, not a check
in the use case. Two tabs open on the profile page both pass a read-first check
and both reach the insert; the second one has to lose, and the database is the
only place that can decide that. The use case checks first anyway, so the
ordinary case — the person forgot they already asked — is a message rather than
an aborted transaction.

Withdrawn and rejected rows are not pending, so asking again after either one
simply works.

## 6. A repair on the way past

`drizzle-kit generate` had been refusing to run: the snapshots for migrations
0016 through 0018 were byte-identical copies of 0015, all four claiming the same
id and the same parent. Those three migrations were hand-written, and the
snapshot files were copied rather than generated.

The chain is relinked and 0019's snapshot is generated from the schema, so it
describes the current database rather than the database as it stood at 0015.
Snapshots 0016 to 0018 remain stale in content — they are historical records that
nothing diffs against now that a correct head exists.

## 7. Still open

The centre's request queue still shows a request awaiting a bystander and ages
it, but nothing closes one that never gets collected (ADR 0011 §5). That is the
remaining ending with a screen and no button.
