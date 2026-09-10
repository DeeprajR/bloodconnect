# ADR 0008: Centre depth, and a grant that said no

Date: 2026-09-09 · Status: accepted

Phase 6 of the build plan: the three tag-collision cases, returns and
quarantine, discards with a disposal route, the counter roster and walk-ins.
Two of those turned out to be harder than the screens suggest, and one of them
was refused outright by the database.

---

## 1. A tag that already exists is three situations, not one

§4 is unusually specific here, and the reason is that all three look identical
to somebody holding a reader:

| The register says the bag is… | What actually happened | What the screen offers |
|---|---|---|
| `issued` or `reserved` | It left, and it has come back | Record a **return** |
| `discarded` · `expired` · `lost` | The tag outlived its bag | **Release**, then register anew |
| `available` | Two bags, a stale register, or a cloned tag | **Nothing.** Raise a discrepancy |

`classifyTag` is pure and total, a test walks every bag status through it,
because a status nobody classified would fall through to "unassigned" and open
the intake form on a tag carrying a live unit.

**Case 3 offers no resolution at all**, and that is the whole design. The
pressure to add a "register it anyway" button will come from busy staff on a
bad night, and the answer is no: every one of the three explanations can put
the wrong unit into a patient. The screen says stop, and asks somebody to go
and physically find the conflicting unit.

Case 2 is deliberately **two steps** rather than one "reassign" button. A
single button invites somebody to race past what happened to the previous bag,
and the new bag is a new record with its own collection date and its own
expiry, never an edit of the old one.

A discrepancy never auto-resolves, never expires, and is touched by no
scheduled job. It closes exactly three ways, each requiring a person, a finding
and a note, and the database says so:
`tag_discrepancies_resolved_check` requires all four columns together, so a row
closed without them is impossible rather than merely discouraged.

## 2. Returns: the time out of storage decides, not the operator

The band is asked **first**, and the outcomes below it change with the answer.
An interface that offered "back on the shelf" and then refused it would teach
somebody to report a shorter time next time.

`bag_returns_restock_check` enforces it in the database:
`outcome <> 'restock' OR out_of_storage_band = 'under_30m'`. No screen and no
future code path can put a unit back that was out too long, or out for a time
nobody can say. Where §4's answer is quarantine, because the conservative
reading of "we do not know" is never the shelf.

**The expiry is never recalculated on return.** It is a property of the
donation, not of the bag's travels.

Quarantine ages visibly, and the overdue count is on the overview, because a
waiting room nobody can see is where units are forgotten.

## 3. The walk-in that the database refused

`recordWalkIn` was built the way `docs/backend-architecture.md` described it:
insert a row into `donor_demand_confirmations`, marked as a walk-in. It passed
every test. The suite connects as `migrator`, which holds every privilege.

Then it ran as `app_web`:

```
permission denied for table donor_demand_confirmations
```

**The refusal was right.** §5.1 gives the centre SELECT and five UPDATE columns
on that table and no INSERT at all, because the bot creates the roster and the
centre records what happened at the counter. A centre that could invent
confirmations could inflate the counters the bot owns. The architecture note
contradicted the ownership table two sections above it; the grant is the
authority, and the grant won.

So a walk-in is now the centre's own record in its own table,
`hospital.walk_in_donations`. The third table in the contract, and a minor
bump to **1.2.0** since it is additive from both sides.

### The bot has to see it

The first version of the fix stopped there, and would have been quietly wrong.
A demand for three units with two walk-ins against it still shows the bot three
units outstanding, so it keeps recruiting, and the people it recruits are real
ones who would travel to a counter that does not need them. That is the same
harm §7.6's stand-down exists to prevent, arriving by a different road.

`bot.bot_requests.walk_in_units` is the bot's running copy, synced by the ticker
from a read of the centre's table. It sits **beside** `units_needed` rather than
being subtracted from it, so the original need stays legible: three units were
wanted, one walked in, two donors are still worth calling. Every question of the
form "does this still need people?" counts it. The accept guard, waitlist
promotion, what a donor is told is outstanding, and the completed ending.

Donors who already confirmed are **not** stood down when walk-ins cover the
need. They committed, they are expected, and turning them away after they said
yes is its own harm. What stops is new invitations.

## 4. What the test suite could not have told us

Everything in §3 was found by `pnpm smoke:centre`, which runs P6's writes as
`app_web` against a real database and then asserts what that role must **not**
be able to do. Insert a confirmation, rewrite a walk-in, edit a discard, delete
a return, a quarantine or a discrepancy.

`TEST_DATABASE_URL` connects as `migrator`. A green suite therefore says nothing
whatsoever about whether the column-level grants permit the code that has to run
under them. This is the second time that gap has bitten: ADR 0005 records the
same class of failure in `decideRequest`, against `centre_decisions`.

Both times the fix was the code, not the grant.

## 5. Deltas from the spec

- **`donated_blood_group`** on the confirmation row (contract 1.1.0, recorded in
  ADR 0007 as an open question). The counter types the group off the unit it
  collected, and that is the only thing that can ever set
  `bot.donors.blood_group_verified_at`, without which §7.7 recruits nobody.
  When the typed group differs from what the donor believed, the typed one wins
  and `donor.group_corrected` records both.
- **The roster is its own page**, not a section of the demand list. Donor names
  and phone numbers are the only donor contact details that cross into the
  centre's half of the database (§2.10), and they belong where somebody is
  calling a name at a desk.
- **`walk_in_donations`** and **`bot_requests.walk_in_units`**, as above.

## 6. Still open

- The demands list shows the bot's `completed_units`; walk-ins are counted
  separately on each roster rather than added into that figure, because it is a
  bot-owned column and adding to it would misattribute the count. Whether the
  centre's overview should show a combined figure is a wording question for the
  centre, not a technical one.
- `walk_in_donations` holds a name and a phone number with no consent record
  behind them. The person gave them at a desk, not through the bot's consent
  flow. §12.1's disposal rules cover the unit; what retention applies to the
  donor's details here is part of the same question counsel already has about
  full patient records (§12.2).
