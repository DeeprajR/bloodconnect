# ADR 0010: The doctor app becomes a request slip

Date: 2026-09-09 · Status: accepted · Supersedes parts of §3

A change of shape, not of scope: **the doctor's job is now four fields and an
ID.** Everything else about a request, the patient, the admission, the clinical
context, the sample, is entered by the blood centre.

---

## 1. Why

The original §3 digitised the paper form end to end, and the doctor filled all of
it: patient identity, demographics, contact, address, diagnosis, history,
previous transfusion and reaction, then the request itself. Around twenty fields
at a bedside, on a phone, by somebody handling several patients at once.

That is the wrong place to spend a doctor's attention. The information is not
wrong or unnecessary. It is simply not theirs to type. The centre has a counter,
a person at it, and a bystander standing in front of them who knows the patient's
name and can spell it.

So the split moves:

| | Before | Now |
|---|---|---|
| Doctor | Patient, admission, full request | Blood group, product, units, urgency |
| Centre | Decide, issue | All of the above, plus patient, admission, sample |
| The handoff | - | An ID the doctor reads aloud to the bystander |

The doctor's flow is: sign in → four fields → an ID on screen → read it to the
bystander. The bystander carries it to the blood centre, and the centre's work
starts there.

## 2. What the doctor still enters, and why product stayed

Blood group, **product**, units, urgency.

Product was the one that could have gone either way, and it stays with the
clinician deliberately: whole blood, packed cells, platelets, plasma and
cryoprecipitate are not interchangeable, and which component a patient needs is a
clinical decision that the centre cannot infer from a group and a count. A silent
default to packed red cells would be a clinical field filled in by a constant.

Four fields is still a form somebody can complete while walking.

## 3. Urgency, and the clock it actually runs on

Four levels, each deriving a needed-by date rather than the doctor typing one:

| Urgency | Derived date | Answer expected within |
|---|---|---|
| Emergency | today | 15 minutes |
| Very urgent | today | 1 hour |
| Urgent | today | 4 hours |
| Routine | +7 days | - |

Three of the four land on the same date, and that is the point worth noticing:
**the difference between them is how fast somebody walks, not what day it is.**
A calendar date cannot express it, and the expiry sweep, which flags a request
when `date_required` has passed, would not notice an unanswered emergency until
midnight, which is several hours after it stopped mattering.

So two things follow, and both are part of this change rather than a later
refinement:

- **The centre queue is ordered by urgency**, then by the derived date, then by
  submission time. Date alone would put a routine request raised on Monday above
  an emergency raised this morning.
- **The queue shows time since submission** against a per-urgency threshold, and
  flags a request that has passed it. That is the clock an emergency runs on.

`date_required` stays in the schema and keeps its meaning for everything
downstream, the donor demand's date, the bot's needed-by, the expiry sweep, so
none of that machinery changes. It is now derived rather than typed. Both the
offsets and the response thresholds are configuration (§12), because they are
exactly the kind of number a centre will want to tune in its first month.

## 4. The ID is an identifier, not a secret

`DDMMYY-NNNNN`, `090926-00001`, with the date part prefilled wherever it is
typed, so the counter enters five digits for a request raised today.

It is read aloud in a corridor and typed at a counter, so it is short, it is
sequential within a day, and it is **guessable**. That is acceptable and it is
also a constraint to write down:

> **The ID identifies a request. It does not authenticate anybody.**

Knowing it must never be enough to act on a request. At the counter a person is
physically present and the centre verifies the patient by other means, which is
what makes it safe there. It follows that nothing keyed on this ID alone may ever
be exposed publicly, no status page, no API lookup, no "track your request"
link. Anyone who later wants one needs a second factor, and this paragraph is why.

The counter resets daily, so the sequence is per-day rather than per-year and
`blood_request_counters` is keyed by date. Five digits is 99,999 requests in one
day, comfortably past any real load.

## 5. The emergency exception

A request cannot normally be decided before a patient is attached. Blood leaving
a fridge has to be traceable to a named person, which is what §4's traceability
and the crossmatch sample both assume.

**Emergency is the exception.** The centre may reserve and issue against a
request with no patient yet, because the alternative in a real emergency is
waiting for a bystander to arrive before releasing units, and that is a worse
failure than an incomplete record. Three things make it an exception rather than
a hole:

1. It applies to `emergency` only. Every other urgency needs the patient first.
2. The decision records that it was made against an unidentified patient, with
   who made it.
3. The request carries that visibly until the patient is attached, and the centre
   queue lists it as outstanding. An issued unit pointing at nobody is a debt,
   and it is shown as one.

## 6. What this deletes

Honest accounting, because some of this was built recently:

- **Drafts.** A four-field form does not need saving and reopening. `draft` leaves
  the request state machine, and with it draft ageing and the stale-draft
  surfacing on the doctor's dashboard (P5).
- **The review screen.** Four fields on one screen are their own review.
- **Patient and admission entry in the doctor app**, along with duplicate
  detection. The last of which is not deleted but **moves**: the centre now
  creates patients, so the centre needs the duplicate warning.
- **`indication` as a doctor field.** It moves to the centre with the rest of the
  clinical context. Open question below.

The patient, admission and sample tables are unchanged. Only who fills them in
moves.

## 7. Open questions

1. **Indication for transfusion.** It is now recorded by the centre from what the
   bystander and the notes say, which is second-hand for a clinical
   justification. The alternative is a fifth field for the doctor. This needs the
   medical lead's view before P13, and it is the one field in this change where
   the simplification might have gone one field too far.
2. **`patient_snapshot` moves.** It was frozen at submit (§2.6), when the patient
   was known. There is no patient at submit any more, so it freezes when the
   patient is attached. The snapshot's purpose, a request keeps what it was
   answered with, is unchanged.
3. **Nothing carries the ID back to the doctor's phone.** The doctor sees their
   own requests and their status, which is enough. Whether a doctor should be
   notified when their request is answered, rather than checking, is a P8
   question.
