# ADR 0005 — The centre decision, and three things the database caught

Date: 2026-09-08 · Status: accepted

Phase 3 of the build plan: the centre answers a request from stock, and a shortfall becomes
demand. This is the first half of the loop in §1 closing.

---

## 1. Module 2 is a package, and it may not name a Module 1 table

`packages/centre` sits beside `packages/hospital` and `packages/platform`, for the same reason
they do: §11.2 forbids one module reading another's tables, and both applications need one of
them.

**The problem dependency-cruiser cannot solve.** Both modules legitimately import
`@blood-connect/db` for their own schema. The tool sees one allowed edge and has no way to tell
`blood_bags` from `blood_requests` inside it. So the boundary would have been a convention, and
§11.2 is explicit that conventions are what fail here.

**What was built instead.** `packages/hospital/src/for-centre.ts` is a narrow, purpose-built API —
`listRequestsAwaitingDecision`, `getRequestForDecision`, `markRequestDecided` — and
`packages/centre/src/boundary.test.ts` reads Module 2's own source and fails the build if a
Module 1 table name appears in it. Same shape as the CI grep §5.9 asks for on the bot's
migrations, and for the same reason. The test also asserts that it *can* go red, because a
boundary check that cannot fail reports safety it never established.

**A property that falls out of this.** The centre reads the **frozen snapshot** (§2.6), never the
live patient. That is not a compromise made to keep the boundary clean — it is the more correct
answer. The snapshot is what the doctor told the centre, and editing a patient a week later must
not change what the counter is answering.

`markRequestDecided` takes a `Transaction` rather than a context, so the status change and the
decision row commit together. When the centre becomes its own deployment (§1) this becomes an
HTTP call and a saga; today one process owns both, and one transaction is strictly better.

---

## 2. The demand is raised **before** the decision row. §7.2 puts it last.

§7.2's sketch ends with `INSERT INTO donor_demand`. The implementation raises the demand first and
writes `demand_id` onto the decision row as it is inserted.

**Why.** Migration 0010 revokes `UPDATE` and `DELETE` on `centre_decisions` from `app_web`. A
decision is a clinical record of what the centre answered; it is corrected by a later action
against the request, never by rewriting the row — the same treatment `audit_log` gets. So the row
has to be complete when it is inserted, which means the demand exists first.

**What is unchanged.** Everything §7.2 is actually about. Both writes are in one transaction, so a
shortfall still cannot exist without its demand row, and the loser of a decision race rolls the
demand back along with everything else.

**How this was found.** The first version updated the decision afterwards. Every test passed —
they connect as `migrator`. The end-to-end run as the real `app_web` role failed with `permission
denied for table centre_decisions`, which is exactly what that grant is for. The fix was to change
the code, not the grant.

---

## 3. What the transaction claims, and in what order

```
1. claim bags   FOR UPDATE SKIP LOCKED, oldest expiry first   -- locks, writes nothing
2. raise demand if there is a shortfall and the product recruits
3. insert the decision                                        -- the unique constraint fires here
4. reserve exactly the bags from (1), record which
5. move the request to its answer                             -- conditional UPDATE on 'submitted'
```

**The claim writes nothing.** The constraint in (3) is tested before a single bag is marked
reserved, so the loser rolls back having reserved nothing rather than stranding units as
`reserved` for a decision that never existed. Proven: eight-way and two-way races leave exactly
one decision, and exactly the winner's units held.

**Exact group match, never a compatible one.** Substituting a compatible group is a clinical
judgement a person makes, not one this system takes silently (§2.7). The compatibility matrix is
for recruiting donors, and only there.

---

## 4. Decisions taken that the spec leaves open

| Decision | Why |
|---|---|
| **The floor counts red cells only** — whole blood and PRBC | A floor met by bags of plasma reads as comfortable while there is nothing a walk-in donor could replace, and "recruit for groups below floor" would then raise a demand nobody can fill. Stated on the screen, not just here |
| **Declining on the merits raises no demand** | A shortfall recruits; a refusal does not. Recruiting donors for a request the centre has just refused sends real people out for nothing. An empty shelf is the *fill* path with zero available, and that does recruit |
| **The counter does not type a number of units** | It is whatever the shelf holds at the instant the transaction runs. A figure typed thirty seconds earlier is a figure that may already be wrong |
| **A floor demand is for whole blood** | That is what a walk-in donor gives; the components are made from it |
| **The stale-bag sweep exists but nothing schedules it** | `expireStaleBags` is written and tested. The `worker` process of §1 is not built yet, so it has no caller — said plainly rather than left looking automatic |

### Spec deltas, to reconcile per §11.8

**`donor_demand_open_floor_idx` includes `centre_id`.** §5.6 writes the partial unique index on
`blood_group` alone. `centre_id` is on the table from day one precisely so a second centre is more
rows rather than a migration, and a global index would leave the second centre unable to recruit
for a group the first one is already short of. Identical behaviour for the single centre v1 runs.

**`centre_settings.district_id` is set by the seed, not the migration.** It is a foreign key into
`reference.location_nodes`, and the hierarchy is loaded after the migrations run. Naming Kozhikode
in migration 0010 would make a fresh database fail to migrate. The demand use case refuses to
raise a demand while it is unset, rather than sending donors an address with a hole in it.

---

## 5. Tag collisions are detected and refused, not resolved

§4's three cases are classified from the register — the presented tag's bag is on the shelf
(case 3), live (case 1), or finished (case 2) — and each gets its own message naming what actually
happened. **None of them offers a resolution.** The returns flow, the quarantine list and the
discrepancy workflow are P6.

Case 3 in particular will never get a "register it anyway" button. The register believing a bag is
on the shelf while somebody holds its tag means the register is stale, two bags carry the same
tag, or the tag is cloned — and every one of those can put the wrong unit into a patient. §4 and
§14 both say the correct behaviour is to stop and make a person go and look.

Deliberately absent tables, rather than present and unused: `bag_returns`, `bag_quarantines`,
`bag_discards`, `tag_discrepancies`, `storage_devices`, `camera_calibrations`,
`calibration_regions`, `stock_observations`, `observation_regions`, `stock_reconciliations`.
Nothing should read as finished when it is not.

---

## 6. Three bugs the tests did not find, and what did

Every one of these passed the unit suite and failed against a real database. The pattern is worth
keeping: **run it for real before believing it.**

| Bug | How it presented | Fix |
|---|---|---|
| Two operators presenting the same **new** tag both inserted it | `duplicate key value violates rfid_tags_pkey`. `SELECT ... FOR UPDATE` locks nothing when the row does not exist yet | `INSERT ... ON CONFLICT DO NOTHING` first, then `FOR UPDATE`. The insert creates the row or waits for whoever is creating it |
| The decision race was reported as a crash | Drizzle wraps the driver's error, so reading only the top level never saw the constraint | Walk the `cause` chain, and match **only** `centre_decisions_request_idx` — any other unique violation is a bug and must keep throwing |
| The decision row was updated after insert | `permission denied for table centre_decisions`, as `app_web` | Raise the demand first and insert the decision complete. See §2 above |

The contract grants now have their own suite (`db/src/schema/contract-grants.test.ts`) that
connects **as each application role** and proves the database agrees with `packages/contract`:
the bot cannot set `units`, the centre cannot set `confirmed_units`, the centre cannot invent a
roster row, and the column lists in the package match the grants in the migration column by
column. That is the third of the three defences §11.2 asks for, and the only one that still holds
when the application logic is wrong.

---

## 7. Wording

The §2.7 table gained Module 2's terms — `unitNumber`, `collectedOn`, `expiresOn`, `stockFloor`,
`quarantine`, `walkIn` — pinned by the same regression test, written while the labels were being
typed for the first time.

None of them is abbreviated. A counter reads these under time pressure, and "Unit no." and "Exp."
save three characters at the cost of the one moment somebody notices a wrong date.
