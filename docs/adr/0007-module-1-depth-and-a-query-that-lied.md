# ADR 0007: Module 1 depth, and a query that quietly lied

Date: 2026-09-09 · Status: accepted

Phase 5 of the build plan, plus a review of everything from P0 to P4 that the
user asked for before proceeding. The review found more than the phase did.

---

## 1. Cancelling a request, which is the ending the loop is judged on

§3 gives the doctor exactly one post-submit action, and says why: *"without it
the centre chases units nobody needs"*. §14 names what it prevents as the
failure the system most has to avoid. A confirmed donor travelling to a
hospital that no longer needs them.

Three modules' tables move together, in one transaction:

1. The **request** goes to `cancelled` with a reason (Module 1).
2. Any **reserved bags** go back on the shelf (Module 2).
3. Any **open demand** is withdrawn (the shared contract), and the bot's ticker
   turns that into a stand-down for every donor still holding a place (§7.6).

A request showing cancelled while units stay held for it, or while donors are
still being recruited, is worse than not cancelling at all.

**Only `reserved` bags are released.** A unit that has been `issued` has
physically left the fridge and is not the register's to reclaim. That is a
return, decided with the unit in hand (§4).

**The reason is required by the use case, not only by the form.** The centre may
already have pulled units and donors may already have agreed to come; "cancelled"
with no explanation leaves both of them guessing.

Verified end to end on the development database: request raised, answered short,
a real donor confirmed and on the counter's roster, then cancelled. Units back,
demand withdrawn, every donor stood down, none left unsent.

### Where it lives, and why that is not where it is performed

`packages/centre`. §11.2 lets exactly one of these two modules see the other,
and it is that one: Module 1 cannot name `blood_bags` or `donor_demand`. The
permission it checks is the doctor's `requests:manage`, not the counter's:
**where a use case lives and who may run it are different questions**, and the
alternative was either a cycle between the two packages or three separate
transactions that can half-apply.

---

## 2. The transition table was wrong, and the spec said so all along

`bloodRequestTransitions` had `approved: []` and `partially_approved: []`.
Written in P0 from reading the status list rather than the flow.

But bags are only ever reserved **by** a decision. If those were terminal,
§3's "cancelling releases any reserved bags" could never fire, and units would
sit held for a patient who has improved, died or been referred.

Both now allow `cancelled`. `declined` stays terminal, because nothing is held
for a declined request and the ward raises a new one rather than reopening it.
The state-machine test that pinned "four terminal states" now pins two, and says
why.

**This is what writing the use case is for.** The table read fine for five
months of build; it was wrong the moment something needed the edge.

---

## 3. A correlated subquery that returned null and never errored

The duplicate-patient warning asks "is this person on a ward right now" with a
subquery in the select list:

```ts
sql`(SELECT a.ip_no FROM hospital.admissions a WHERE a.patient_id = ${patients.id} …)`
```

Drizzle renders a column reference inside a **select-list** `sql` without its
table, a bare `"id"`, which inside that subquery resolves to `a.id`, the
admission's own. `a.patient_id = a.id` is never true. Every patient came back
with no open admission, and nothing errored.

In a `where` clause the same expression is fully qualified. It is specifically
the select list that is not, which is what makes this hard to see.

**The same mistake was in the bot**, where `alreadyAsked` on the donor's needs
list compared a journey row's id against itself and was therefore *always
false*. One test written for Module 1 exposed a bug in Module 3.

Both now write the column out, `hospital.patients.id`, `bot.bot_requests.id`,
and both have a test that fails if the flag stops working. The rule earned:
**never interpolate a Drizzle column into a correlated subquery in a select
list.**

---

## 4. The rest of P5

| Built | Note |
|---|---|
| **Duplicate-patient warning** | Trigram similarity, shown beside the field, **never a block**: two people genuinely called Anitha Menon arrive at the same hospital, and refusing the second admission at 3am is far worse than recording a duplicate. Name, hospital ID, group, and whether they are on a ward: enough to recognise somebody and no more (§2.10), asserted by a test on the returned keys |
| **Draft ageing** | §8: an abandoned draft ages visibly and is never auto-deleted. The dashboard shows the age, not a timestamp, and flags one past `ageing.draft_days` |
| **Compatibility testing sample** | §2.7's name, never "blood sample". The identifier is unique **globally**, not per request (§15), because it travels on a tube between the ward and the laboratory and two tubes with one label is the mix-up the test exists to catch. More than one sample per request, because a repeat draw is ordinary |

Already delivered by earlier phases and not rebuilt: the invite and password
flows, OTP reset with identical refusals, the administration panel and its
safeguards, `email_deliveries` as an outbox, seals to MinIO, and the PWA shell.
The account update-request queue is superseded by ADR 0003. The doctor confirms
their own address change, and no administrator approves it.

---

## 5. Two gates the specification names by hand, now checked

Both were correct across P0–P4 and neither was enforced, which on a solo build
means they hold until somebody forgets.

**Every page decides access** (§13). Layer two of the three is per page, and the
role-matrix test asserts the shared decision function rather than any particular
page calling it, so a page with no guard passes every existing test and leaks.
Five are public by design and listed with reasons.

**Every mutating use case records what it did** (§2.9, §14): "a new use case
with no audit write fails CI" is the spec's own wording. The discriminator is
§3's own rule rather than an allowlist: **a use case opens the transaction, a
repository is handed one.** That settles the adapters without naming them, since
`hash.update()` and an object-storage `delete()` are not database writes. The
first version matched bare substrings and cried wolf on all four.

Also verified in the review and not previously checked: both migration sets and
the seed apply cleanly to an empty database (§5.9), and all three deployables
build.

---

## 6. Still open

**A donor registering through the bot is not recruitable.** §7.7 requires
`blood_group_verified_at`, and nothing sets it. The centre is the authority on
a donor's group, but `app_web` holds no grant on `bot.donors`, so it *cannot*.

The contract has no column for the counter to report the group it typed:
`donor_demand_confirmations` gives the centre `status`, `donated_at`,
`bag_identifier` and `marked_by`, and none of those carries a blood group. So
the bot cannot learn a verified group from a completed donation either.

Closing this is an **additive contract change**. A minor version bump, and per
§11.8 both sides ship together. It belongs with the counter work in P6, together
with the walk-in flow (§4), which is how somebody first gives blood and therefore
how their group first gets typed at all. Named here rather than worked around,
because the workaround would be to trust a self-declared group, which is exactly
what the column exists to prevent.
