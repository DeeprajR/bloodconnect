# Blood Connect: input field reference

Every screen that accepts input, and every field on it. Companion to
[modules-spec.md](modules-spec.md), which explains *why*; this document says *what*.

## Type vocabulary

| Type | Means |
|---|---|
| `text` / `textarea` | Free text, single or multi-line |
| `email` `tel` `password` | Validated text |
| `int` `decimal` | Numeric, with stated bounds |
| `date` `datetime` | Calendar day / instant, stored UTC |
| `select` | One of a fixed set |
| `radio` | One of a fixed set, all shown |
| `multi-select` | Zero or more of a fixed set |
| `checkbox` | Boolean |
| `file` | Upload, with stated type and size limits |
| `typeahead` | Text that resolves to a reference row; free text only where stated |
| `search-select` | Search an existing record and pick it |
| `scan` | Reader input, keyboard-fallback to text |
| `canvas` | Drawn region on an image |
| **Chat types** | |
| `buttons` | One tap from a fixed set |
| `button-grid` | Paged grid (dates) |
| `toggle-list` | Multi-select checklist, submitted once |
| `contact-share` | Platform-verified phone number |
| `location-share` | Platform location fix |

**Req** column: ● required · ○ optional · ▣ conditional (condition stated).

**Server-derived** fields are listed where they appear on screen but are never accepted from
the client (spec §2.5).

---

# Module 1: Doctor app

## Sign in

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Email | `email` | ● | - | Lowercased, trimmed |
| Password | `password` | ● | - | Not revealed on error; same message for wrong user and wrong password |
| Return path | hidden | ○ | From URL | Same-origin relative paths only; anything else discarded |

## Set password (from invite link)

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Invite token | hidden | ● | From URL | Single-use, hashed at rest, expires 24–48 h |
| Email | display | - | From token, read-only | Shown so the user knows which account |
| New password | `password` | ● | - | Min 12 chars |
| Confirm password | `password` | ● | - | Must match |

Same form serves **Set new password** at the end of a reset, with a reset token instead.

## Forgot password

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Email | `email` | ● | - | Response identical whether or not the account exists |

## Enter OTP

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| OTP | `text` numeric | ● | - | Exactly 6 digits, ~10 min expiry, single use, throttled per account and IP |

## Change password (signed in)

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Current password | `password` | ● | - | - |
| New password | `password` | ● | - | Min 12, must differ from current |
| Confirm password | `password` | ● | - | Must match |

## Profile: seal

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Seal image | `file` | ● | Current seal shown | PNG only, ≤1 MB, re-encoded server-side |

## Profile: request account update

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Field to change | `select` | ● | - | Email · Display name · Provisional registration |
| Current value | display | - | From account, read-only | - |
| Proposed value | `email` / `text` | ● | - | Type follows the chosen field; must differ from current; uniqueness checked on submit |
| Reason | `textarea` | ● | - | Shown to the approving admin |

One pending request per field per user.

## Patient: create / edit

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Patient name | `text` | ● | - | Duplicate warning on close name + age + group match |
| Date of birth | `date` | ▣ | - | Required unless age given; not future |
| Age | `int` | ▣ | - | Required unless DOB given; ≥ 0 |
| Age unit | `select` | ▣ | `years` | days · months · years; required with age |
| Sex | `select` | ● | - | Female · Male · Other |
| Blood group | `select` | ● | - | A+ A− B+ B− AB+ AB− O+ O− |
| Hospital ID (UHID/MRN) | `text` | ○ | - | Unique if given |
| Attender name | `text` | ○ | - | - |
| Attender phone | `tel` | ○ | - | 10-digit national or E.164 |
| Address | `textarea` | ○ | - | - |
| District | `typeahead` | ○ | - | From location reference |
| City | `typeahead` | ○ | - | Filtered by district |
| Known diagnosis | `textarea` | ○ | - | - |
| Relevant history | `textarea` | ○ | - | - |
| Previous transfusion | `select` | ○ | `Unknown` | Yes · No · Unknown |
| Reaction to previous transfusion | `textarea` | ▣ | - | Shown and required only when previous transfusion = Yes |

## Admission: create

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| IP number | `text` | ● | - | Primary identity of the admission; unique; immutable after create |
| Patient | `search-select` | ● | Prefilled when started from a patient | Must be an existing patient |
| Ward number | `text` | ● | - | - |
| Admitted at | `datetime` | ● | Now | Not future |
| Discharged at | `datetime` | ○ | - | Discharge action only; must be ≥ admitted at |

## Blood request: draft form

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Admission (IP no.) | `search-select` | ● | From `?ipNo=` when present | Locked once the draft exists |
| Patient name / age / group / ward | display | - | From the admission | Read-only; snapshotted at submit |
| Indication for transfusion | `textarea` | ● | - | Standard clinical wording, pinned by test (spec §2.7) |
| Date required | `date` | ● | Today | Not past |
| Requested blood group | `select` | ● | Patient's group | Overridable; 8 groups |
| Product | `select` | ● | `Whole Blood` | Whole Blood · Packed Red Blood Cells (PRBC) · Platelet Concentrate (RDP / SDP) · Fresh Frozen Plasma (FFP) · Cryoprecipitate. Standard component names (spec §2.7); confirm the list against the centre's own component catalogue |
| Units | `int` | ● | `1` | ≥ 1 |
| Doctor name / registration / seal | display | - | Server-derived from session | Never accepted from the client |

**Review screen** takes no input beyond a single Submit action.

## Blood request: cancel (after submit)

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Reason | `textarea` | ● | - | - |
| Confirm | `checkbox` | ● | - | Warns if bags are reserved or a donor demand is open, and how many donors will be stood down |

## Blood sample: associate

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Sample identifier | `text` | ● | - | Globally unique |
| Collected at | `datetime` | ● | Now | Not future |
| Collected by | display | - | Server-derived from session | - |

## Dashboard filters

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Status | `select` | ○ | `All` | All · Draft · Submitted · Cancelled |
| Search | `text` | ○ | - | Request ID, patient name, or IP number |

## Admin: create account

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Email | `email` | ● | - | Unique; becomes the username and the fixed account identity |
| Full name | `text` | ● | - | - |
| Role | `select` | ● | `doctor` | doctor · admin · blood_centre · volunteer_admin |
| Provisional registration | `text` | ▣ | - | Required for doctor and admin; unique |
| District scope | `typeahead` | ▣ | - | volunteer_admin only; empty = all districts |

No password field. The account is activated by invite link.

## Admin: account actions

| Screen | Field | Type | Req | Rules |
|---|---|---|---|---|
| Change role | New role | `select` | ● | Cannot change own role; last active admin protected |
| Activate / deactivate | Confirm | `checkbox` | ● | Cannot deactivate self or the last active admin |
| Re-send invite | Confirm | `checkbox` | ● | Invalidates the previous link |
| Update request | Decision | `radio` | ● | Approve · Reject |
| Update request | Note | `textarea` | ▣ | Required on reject |

---

# Module 2: Blood centre dashboard

## Bag intake (scan an unassigned tag)

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Tag ID | `scan` | ● | From reader | Must be `unassigned`; an assigned tag diverts to the collision screen |
| Unit / donation number | `text` | ● | - | Unique |
| Blood group | `select` | ● | - | 8 groups |
| Product | `select` | ● | `Whole Blood` | 5 products |
| Collected at | `date` | ● | Today | Not future |
| Expires at | `date` | ● | **Derived**: collected at + shelf life for the product | Overridable: the printed label wins; must be ≥ collected at; a mismatch against the derived value is flagged, not blocked |
| Source | `text` | ○ | - | Camp, transfer, in-house |

## Bag edit / discard

| Screen | Field | Type | Req | Rules |
|---|---|---|---|---|
| Edit | Group, product, collected at, expires at, source | as above | - | Status is not editable here; changes audited |
| Discard | Reason | `select` | ● | Expired · Damaged · Contaminated · Cold-chain breach · Lost · Other |
| Discard | Note | `textarea` | ▣ | Required when reason is Other or Lost |
| Discard | Disposal route | `select` | ● | Biomedical waste stream the bag went to (spec §12.1) |

## Inventory filters

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Blood group | `multi-select` | ○ | All | - |
| Product | `multi-select` | ○ | All | - |
| Status | `multi-select` | ○ | `available` | - |
| Expiring within | `select` | ○ | - | 3 · 7 · 14 days |
| Search | `text` | ○ | - | Tag ID or unit number |

## Bag return (collision case 1)

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Bag details | display | - | From the register | Group, product, expiry, issued-to request and time |
| Time outside controlled storage | `select` | ● | - | Bands, plus **Unknown** |
| Cold chain documented | `radio` | ● | - | Yes · No · Unknown |
| Outcome | `radio` | ● | **`Quarantine`** when time or cold chain is Unknown | Restock · Quarantine · Discard |
| Note | `textarea` | ▣ | - | Required for Quarantine and Discard |

Expiry is never recalculated on return.

## Quarantine resolution

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Bag and quarantine reason | display | - | From the register | Includes days held |
| Outcome | `radio` | ● | - | Return to available · Discard |
| Note | `textarea` | ● | - | - |
| Resolved by | display | - | Server-derived from session | - |

## Tag release / re-register (collision case 2)

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Assigned bag | display | - | From the register | Release offered only when this bag is in a terminal state |
| Release reason | `select` | ● | - | Bag issued · Transfused · Discarded · Expired · Tag damaged |
| Note | `textarea` | ○ | - | - |
| Retire this tag | `checkbox` | ○ | Off | Retired tags can never be assigned again |

Re-registering then runs the full **Bag intake** form as a new bag.

## Tag discrepancy resolution (collision case 3)

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Conflicting bag | display | - | From the register | Tag, unit number, group, expiry, status, location |
| What you found | `radio` | ● | - | Conflicting bag is on the shelf (duplicate/cloned tag) · Conflicting bag is missing · This was a mis-scan |
| Note | `textarea` | ● | - | - |
| Resolved by | display | - | Server-derived from session | - |

Each finding drives a fixed action: retire the tag · mark the bag lost · dismiss.

## Request decision

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Request summary | display | - | From the request | Group, product, units, needed by; stock on hand for the group |
| Units to issue | `int` | ● | `min(units requested, available)` | 0 … units requested |
| Bags | `multi-select` | ● | **Auto-selected oldest expiry first** | Overridable; only `available` bags of the group; count must equal units to issue |
| Decision | `radio` | ● | **Derived** from units to issue: 0 → Declined, partial → Partial, full → Approved | Overridable to Declined |
| Note | `textarea` | ▣ | - | Required for Partial and Declined |
| Raise donor demand for the shortfall | `checkbox` | ○ | **On** when there is a shortfall and product is whole blood or packed red blood cells; otherwise off and disabled | Never available for platelet, plasma, cryoprecipitate |

## Stock-floor recruitment

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Groups below floor | `multi-select` | ● | All short groups ticked | Shows current vs floor and the shortfall per group |
| Confirm | `checkbox` | ● | - | Skips any group that already has an open floor demand |

## Demand: cancel

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Reason | `textarea` | ● | - | - |
| Confirm | `checkbox` | ● | - | States how many confirmed donors will be stood down |

## Roster: mark a donor

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Donor | display | - | From the roster | Name and verified phone |
| Outcome | `radio` | ● | - | Donated · No-show · Cancelled |
| Donated at | `date` | ▣ | Today | Shown and required only for Donated; not future |
| Bag identifier | `scan` | ○ | - | Shown for Donated; links the donor to the unit collected |
| Note | `textarea` | ○ | - | - |

## Roster: record a walk-in

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Donor name | `text` | ● | - | Someone who never confirmed in the bot |
| Phone | `tel` | ● | - | - |
| Blood group | `select` | ● | Demand's group | - |
| Donated at | `date` | ● | Today | Not future |
| Bag identifier | `scan` | ○ | - | - |

## Centre settings

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Hospital name | `text` | ● | Current | Snapshotted onto every new demand |
| Hospital address | `textarea` | ● | Current | Shown to donors |
| District | `typeahead` | ● | Current | From location reference |
| City | `typeahead` | ● | Current | Filtered by district |
| Minimum units per group | `int` | ● | `25` | ≥ 0 |
| Shelf life per product | `int` days ×5 | ● | Current | One per product; drives the derived expiry at intake |
| Return time limit | `int` minutes | ● | Current | From the hospital's SOP; drives the Quarantine default |

## Camera: device registration

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Device name | `text` | ● | - | - |
| Storage unit | `text` | ● | - | Which fridge or room |
| Device token | display | - | **Generated** | Shown once at creation; revocable, never re-displayed |

## Camera: region calibration

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Device | `select` | ● | - | Registered cameras |
| Live frame | display | - | Pulled from the device | Stored as the calibration's reference frame for drift detection |
| Regions | `canvas` | ● | Previous calibration's regions when re-calibrating | One rectangle or polygon per shelf, tray or bin |
|: Region label | `text` | ● | - | Per region |
|: Blood group | `select` | ● | - | Per region; the group comes from geometry, never from the image |
|: Product | `select` | ○ | - | Per region |
|: Expected capacity | `int` | ○ | - | Per region; enables an overflow warning |
| Test run | action | - | - | Overlays the model's count per region before activation |
| Activate | `checkbox` | ● | - | Creates a new calibration version; earlier observations keep their own version |

## Reconciliation task

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Region, expected, observed, confidence, frame, recent scans | display | - | From the observation | - |
| Action | `radio` | ● | - | Correct the register · Dismiss the observation |
| Note | `textarea` | ● | - | - |

---

# Module 3: Donor bot

Chat steps rather than screens. Every step is resumable; nothing is committed until step 10.

## Onboarding

| # | Step | Type | Req | Prefill | Rules |
|---|---|---|---|---|---|
| 1 | Phone number | `contact-share` | ● | Platform contact | Arrives **verified**. Manual `tel` fallback is marked unverified until an OTP confirms it |
| 2 | Name | `text` | ● | - | The only free-text field in the interview |
| 3 | Date of birth | `button-grid` | ● | - | Year → month → day. Age is derived, never asked |
| 4 | Sex | `buttons` | ● | - | Female · Male · Other. Sets the donation interval and the pregnancy question |
| 5 | Blood group | `buttons` | ● | - | 8 groups + "I don't know". Unverified until staff type the donor; unverified donors are never matched |
| 6 | Weight | `buttons` | ● | - | Under 45 · 45–50 · 50–60 · 60–70 · 70+ kg. Optional exact `int` follow-up. Below the threshold: registered, not matched, told why |
| 7 | Durable screening | `buttons` yes/no ×N | ● | - | Long-term conditions only. A disqualifying answer flags the profile for human review |
| 8a | Location: share | `location-share` | ○ | - | Reverse-geocoded to all four levels, then **shown for confirmation** |
| 8b | District | `typeahead` | ● | From 8a | From the location reference |
| 8c | City / taluk | `typeahead` | ● | From 8a | Filtered by district |
| 8d | Town | `typeahead` | ● | From 8a | Filtered by city |
| 8e | Locality | `typeahead` | ● | From 8a | Filtered by town; unmatched free text goes to a review queue |
| 9 | Last donation date | `button-grid` | ● | - | Or "Never". Sets the first inter-donation interval |
| 10 | Review and acknowledge | `buttons` | ● | Full summary of 1–9 | Single confirmation covering "details are correct" **and** "send me requests". Declining keeps the registration dormant |

## Step 10: fix answers

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Jump to a field | `buttons` numbered | ○ | - | Or reply with the row number; re-asks that one question and returns to the summary |
| Fields to fix | `toggle-list` | ○ | Nothing ticked | Tick any number, submit once; the bot walks only those in summary order and returns to the summary once |
| Each re-ask | original type | ● | Current value | Same control as at signup. Changing district resets city, town and locality |

Where `toggle-list` is unavailable on a channel, the same list is numbered and `3, 5, 7`
is accepted as a reply.

## Per-request screening

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| 6 temporary questions | `buttons` yes/no | ● | - | Fever, medication, recent tattoo, feeling well, last meal, pregnancy (asked only where applicable). A disqualifying answer removes the donor from **this request only** |

## Request card

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Response | `buttons` | ● | - | Accept · Not this time. Replays are no-ops |

## Profile and preferences

| Screen | Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|---|
| Edit profile | Same summary + toggle-list as step 10 | - | - | Current values | Saving re-records the acknowledgement |
| Snooze | Duration | `buttons` | ● | - | 1 · 3 · 6 months, or a chosen date. Confirms the date it lifts |
| Opt out | Confirm | `buttons` | ● | - | Reversible; says how to come back |
| Delete my data | Confirm | `buttons` | ● | - | Two-tap. States before deleting that donation records are de-identified, not removed |

## Demand board

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Blood group | `buttons` | ○ | Donor's own group, or All | - |
| District | `buttons` | ○ | Donor's district, or All | - |

---

# Module 4: Volunteer dashboard

| Screen | Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|---|
| Group overview | District scope | `select` | ○ | The volunteer's own district | Only districts in their scope; blank = all |
| Group overview | Blood group tile | navigation | - | - | Tapping a tile opens the demands behind it |
| Demand detail | Copy share message | action | - | Generated from live numbers | Read-only; no free text, so nothing unreviewed is published |

No writable fields. The dashboard reads demand and progress only.

---

# Device and machine inputs

Not screens, but they are input surfaces and validated the same way.

## Vision observation (camera → centre)

| Field | Type | Req | Rules |
|---|---|---|---|
| Device token | header | ● | Registered device; individually revocable |
| Device ID | `text` | ● | Must match the token |
| Captured at | `datetime` | ● | Rejected if far from server time |
| Calibration version | `int` | ● | Rejected if not the device's active calibration |
| Regions | array | ● | One entry per calibrated region |
|: Region ID | `text` | ● | Must exist in that calibration |
|: Count | `int` | ● | ≥ 0 |
|: Confidence | `decimal` | ● | 0.0–1.0; below the threshold the entry is recorded as "no observation", never as zero |
| Frame reference | `text` | ● | Key of the stored frame; retained days, not years |

## Tag reader (reader → centre)

| Field | Type | Req | Rules |
|---|---|---|---|
| Reader token | header | ● | Standalone readers only; a reader on a signed-in workstation uses the session |
| Action | `select` | ● | Lookup · Stock · Discard |
| Tag ID | `text` | ● | - |
| Payload | object | ▣ | Per action; Discard requires a reason |
