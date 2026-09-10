# ADR 0013: The volunteer board cannot see a person

Date: 2026-09-10 · Status: accepted

Phase 9: Module 4, the volunteer dashboard, and the public demand board that is
the same data with the sharing tools taken off.

---

## 1. A module, not a folder

§6 says Module 4 owns no data. It would have been easy to read that as "so it
needs no package" and put the queries next to the pages, and that would have
been the wrong reading twice over.

§6 also lists what a volunteer must never be shown here: a patient name, a
request's clinical detail, a doctor's identity, a donor's name or phone number.
Every one of those is a table. A package is what makes the guarantee mechanical
rather than a matter of review: `packages/volunteer` may import `platform` for
its context and `domain` for its rules, and dependency-cruiser fails the build
on an import of `hospital`, `centre` or `bot`.

That is not quite enough on its own, because all four modules legitimately
import `@blood-connect/db` for their own schema, and the boundary checker sees
one allowed edge and cannot tell `donor_demand` from `patients` inside it. So
`boundary.test.ts` reads the module's own source and fails on the name of any
table holding a person. The same shape as the centre's, for the same reason.

The other half of the reading: §11.2 says Module 4 should be splittable into its
own deployment later without an archaeology project. It now could be. Nothing
imports it, and it imports nothing from the other three.

## 2. The shelf is read from a demand, not from the bags

§6's tile shows whether a group is below the stock floor, and §6's data section
gives Module 4 no access to inventory at all. Those look contradictory until you
notice that the centre already publishes the fact: a group under its floor is a
group the centre has raised a `stock_floor` demand for (§4).

So `belowFloor` is `trigger = 'stock_floor'` on an open demand. It keeps the
signal inside the contract of §7, and it is the more honest number besides: it
says the centre has decided to recruit, rather than that a volunteer inferred a
shortage from a count they are not allowed to see.

## 3. Four levels, and green is not available while the shelf is low

`met` / `recruiting` / `short` / `critical`, graded by what somebody does about
it rather than by an even split of the range, which is how the stock bands work
and for the same reason.

Two of the four are structural rather than tunable. Nothing outstanding is
covered by definition. Nobody confirmed is its own state whatever the fractions
say, because zero donors coming differs in kind from few donors coming: there is
nobody to thank and nobody to wait for. The two in between move with
`pressure.recruiting_fraction` and `pressure.short_fraction`.

**A group below its floor is never `met`.** A green tile over an empty shelf
tells a volunteer the opposite of the truth. Where no request is waiting on it
yet, the tile reads `short`: a today job, not a now one.

Colour is never the only signal (§6, §11.10). Every tile carries the group, the
count, a word for the state, and a line of context, and any one of the four is
enough to act on. This is the screen most likely to be read on a cheap phone in
daylight, and daylight takes the colour first.

## 4. The share message is generated, and there is no box to edit it

§9's surface matrix gives this action no free text. The message is built from
the live numbers, so it cannot go stale and cannot say anything nobody reviewed
under a hospital's name. It names a hospital and a town, because that is what
makes somebody walk in, and it names no patient, no doctor and no donor.

The textarea is read-only rather than hidden. The clipboard is not available on
an insecure origin, an old browser or a locked-down work phone, and on those the
message still has to be selectable by hand: a copy button that silently does
nothing is worse than no button.

## 5. The public board's shape is pinned

`publicBoard` returns five fields: group, hospital, town, units outstanding, and
needed-by. A test asserts the key list exactly, so a sixth field fails the build
rather than reaching the open web by being convenient somewhere else (§14).

It is deliberately narrower than what a volunteer sees. No count of who was
notified or who confirmed, because that is the recruitment effort rather than
the need. Demands with nothing outstanding are dropped rather than shown as
covered: an outsider reading this is deciding whether to walk in, and a line
that needs nobody is noise on that decision.

No district scoping either. Scoping is what makes the volunteer view useful and
what would make this one dishonest, because a public page that quietly hid
demand from the person reading it would be worse than no page.

It stays behind `flag.public_board`, which §11.2 asks for by name. Publishing a
hospital's demand to the open web is the centre's decision, not a deployment's.
Off, the page says it is not published rather than showing a sample: an outsider
must never be shown invented demand for a real hospital.

## 6. Live without a refresh button

§6 asks for live and says polling is fine. A poll on `router.refresh()` re-runs
the server component and swaps the data without unmounting anything, so a
volunteer reading a demand list does not lose their place mid-poll.

It stops while the tab is hidden, and refreshes on the way back. A dashboard
left open on a phone in a pocket should not spend the evening waking the radio
for numbers nobody is reading.

## 7. Trend, and only here

§6 calls this the only place aggregate history is shown, so it is one strip of
six weeks: units asked for against units met. Bucketed by `date_required`
rather than by when a demand closed, because that is the week the blood was
actually needed, and because `donor_demand` has no closed-at column so the
alternative would be `updated_at`, which moves every time a counter increments.

Every bar carries its two numbers. §11.10 does not stop applying when a thing
looks like a graph.

## 8. Still open

The centre's request queue ages a request awaiting a bystander but nothing
closes one that never gets collected (ADR 0011 §5). That remains the last ending
with a screen and no button.
