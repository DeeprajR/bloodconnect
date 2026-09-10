# Blood Connect: system specification

What each module is, who uses it, what it does, and the rules it must not break.

This is the specification the system is built to. It describes behaviour and constraints,
not files or classes, so it can be implemented in any reasonable stack: §11 records the
stack decisions taken and which of them are open.

Field-level detail, every input on every screen, with types, defaults and validation,
is in §15.

## Contents

| | Section | What it covers |
|---|---|---|
| 1 | [The problem and the loop](#1-the-problem-and-the-loop) | Why this exists, the four modules, how they connect |
| 2 | [System-wide principles](#2-system-wide-principles) | Ownership, roles, accounts, identity, terminology, audit, privacy, channel portability, the stock trust model |
| 3 | [Module 1: Doctor app](#3-module-1-doctor-app) | Auth, patients, admissions, the request form, samples, admin panel |
| 4 | [Module 2: Blood centre dashboard](#4-module-2-blood-centre-dashboard) | Tag reader + camera inventory, tag collisions, decisions, demand, roster |
| 5 | [Module 3: Donor bot](#5-module-3-donor-bot) | Onboarding, eligibility, waves, the donor journey, self-service |
| 6 | [Module 4: Volunteer dashboard](#6-module-4-volunteer-dashboard) | Live demand per blood group |
| 7 | [The contract between the modules](#7-the-contract-between-the-modules) | The two shared tables |
| 8 | [Flow index](#8-flow-index-every-flows-way-in-and-ways-out) | Every flow's way in and ways out |
| 9 | [Role and surface matrix](#9-role-and-surface-matrix) | Who can reach what |
| 10 | [Non-functional requirements](#10-non-functional-requirements) | Design system, deployment, dependencies, licence |
| 11 | [Engineering standards](#11-engineering-standards-how-to-keep-this-changeable) | Module boundaries, stack, coding rules, testing, CI |
| 12 | [Legal and regulatory compliance](#12-legal-and-regulatory-compliance) | What applies, DPDP mapping, retention, residency, licensing |
| 13 | [Scope](#13-scope-what-the-first-release-does-not-include) | What the first release does not include |
| 14 | [Risks worth naming now](#14-risks-worth-naming-now) | The 18 ways this plausibly fails |
| 15 | [Appendix: input field reference](#15-appendix-input-field-reference) | Every input on every screen, with types and prefills |

**How to read this.** Sections 3–6 are the modules; 7–9 are how they fit together; 11–12 are
the rules any implementation must follow. If you are building a screen, start at §15 for its
fields and follow the cross-references back for the reasoning.

---

## 1. The problem and the loop

A hospital needs blood for a patient. Today that means a paper request form, a phone call
to the blood centre, and, when the shelf is empty, a message forwarded around asking
strangers to show up. Three disconnected steps, no shared state, and no record of what
happened.

Blood Connect is those three steps as one loop over one database:

```
Doctor  ──── submits a blood request ────▶  request (submitted, immutable)
                                                  │
Centre  ──── decides it ──────────────────────────┘
             issue bags from stock, oldest expiry first
             shortfall?          ──▶ raise donor demand
             group below floor?  ──▶ raise donor demand
                                                  │
Bot     ──── imports open demand ─────────────────┘
             waves of eligible donors, nearest locality first
             donor accepts → screening → confirmed → told hospital + time
                                                  │
Counter ──── marks Donated / No-show / Cancelled ─┘
             bot rolls the donor's inter-donation interval forward, thanks them, closes the demand
```

Four modules sit on that loop, in two deployable pieces. **Modules 1, 2 and 4 are one web
application** with three role-gated sections; **Module 3 is a separate long-running
process**. They never call each other over HTTP. The integration is two shared tables (§7).

| # | Module | What it is | Primary users |
|---|---|---|---|
| 1 | Doctor app | Installable web app: patients, admissions, the blood request form, submit, samples | Doctors, hospital admins |
| 2 | Blood centre dashboard | Same web app, `/centre`: tag-scanned and camera-counted fridge inventory, decide each request, raise and track donor demand | Blood centre staff |
| 3 | Donor bot | Chat bot (Telegram first, WhatsApp planned): finds eligible donors, notifies them, screens them, stops at the unit count | Donors, volunteer admins |
| 4 | Volunteer dashboard | Small read-mostly web view of live demand per blood group | Volunteer admins |

Module 4 is not a fourth codebase. It is a role-gated section of the same web app as
Modules 1 and 2, listed separately because it has its own audience and its own answer to
"what is this for". It exists because a chat card is a bad place to see the whole picture.

---

## 2. System-wide principles

These hold across all four modules. They are the constraints that shape every design
decision below, and none of them should be relaxed without a deliberate review.

### 2.1 One database, clear ownership

One PostgreSQL database. The web app owns the hospital schema and creates every table in
it through migrations. The bot owns its own schema, donors, waves, questionnaire answers,
its event log, and never creates or writes a hospital table other than the two shared ones
in §7. Those two tables are the entire contract between the centre and the bot.

### 2.2 Roles, and no self-registration

Four staff roles. There is no public sign-up for any of them. An admin provisions every
account, and a seed script bootstraps the first admin. Donors are the exception: they
self-register, but only inside the chat bot, and they never touch the hospital app.

| Role | Can reach |
|---|---|
| `doctor` | Patients, admissions, blood requests, samples, own profile |
| `admin` | Everything a doctor can, plus account administration |
| `blood_centre` | The centre section only (admins also pass; doctors never do) |
| `volunteer_admin` | The volunteer dashboard only: demand per group, no patient or clinical data |
| *donor* | Not an account. A chat identity, self-registered, with no web surface at all |

A doctor must not be able to decide on their own request. That is why `blood_centre` is a
separate role and not a permission bolted onto `doctor`. A volunteer admin is an outsider
to the hospital: their role grants an aggregate view and nothing else, never a patient
name, a request, or a donor's phone number.

### 2.3 Account lifecycle and email

Staff accounts have a lifecycle the system must own end to end, because there is no sign-up
page to fall back on.

- An admin creates the account. The system emails the new user their username (their email
  address) and a **single-use invite link** on which they set their own password. No
  password is ever generated for them, mailed to them, or known to the admin.
  - The link expires (24–48 hours), is single-use, is invalidated by being used or by a
    re-send, and its token is stored hashed.
  - An expired or already-used link leads to a "request a new invite" page, not a dead end.
  - Until the link is used the account exists but cannot sign in.
- **The email address is the account's fixed identity.** A user cannot change it themselves;
  it is the anchor for password reset, so letting the user rewrite it would let anyone who
  borrows a signed-in session take the account permanently.
- **Password reset** is self-service: enter the registered email, receive a numeric OTP,
  enter it, set a new password. The OTP is short-lived, single-use, rate-limited per
  account and per IP, and stored hashed. Reset always goes to the address already on the
  account, never to one typed at reset time.
- **Account detail changes** the user cannot make themselves, the display name and the
  provisional registration number, go through a **request queue**: the user submits the
  change with a reason from their profile page, an admin sees it, approves or rejects it
  with a note, and the user is told either way. Nobody decides their own request, and
  every decision is audited. The email address is not in the queue; it has the stronger
  flow of §3, confirmed by a link sent to the proposed address (ADR 0012).

An invite link rather than a mailed password is a deliberate choice: a mailed password
would sit in the mailbox permanently, and mail is not a confidential channel. The user
experience is the same, open the email, click, choose a password, and no secret is ever
at rest anywhere.

### 2.4 Transactional email is infrastructure

Three flows depend on email delivery: the account invite, the reset OTP, and update-request
outcomes. That makes an email provider a hard dependency, not a nice-to-have, and it brings
its own requirements: a verified sending domain with SPF/DKIM/DMARC, a bounce and complaint
path, delivery status recorded against the account, and a way for an admin to re-send an
invite that never arrived. Treat "the email did not arrive" as a normal support case with a
UI, not an incident.

### 2.5 Server-side identity

Doctor name, provisional registration number, and seal are always read from the
authenticated account on the server. They are never accepted from the client, even as
hidden form fields. The same applies to the centre user id on every centre write, and to the
donor's chat identity, which comes from the messaging platform and is never typed.

### 2.6 Immutability and snapshots

A blood request is immutable from the moment it is submitted, and there is no earlier state:
ADR 0010 removed drafts, because a four-field form is submitted or it never existed.
Submitting allocates a human-readable Request ID (`DDMMYY-NNNNN`) from a transactional
**per-day** counter (§7.1) and freezes the record.

Anything that appears on a printed or historical record is **snapshotted** at write time.
Doctor name, registration and seal on the request at submit; patient name, age, blood group
and ward when the centre attaches the patient; hospital name and address on a donor demand.
A later edit to the patient or to centre settings must never rewrite history. The patient
half of the request snapshot is taken later than the rest now, because there is no patient at
submit; its purpose, a request keeps what it was answered with, is unchanged.

### 2.7 Standard clinical terminology

**Every clinical term in this system uses its standard name and correct spelling.** Where a
hospital's paper form carries a local variant or a misspelling, the standard term is used
and the paper form is corrected, not copied. A screen that says `Cryopresipitate` teaches
the wrong spelling to every house surgeon who reads it, and is quoted back in records that
outlive the software.

The reason the paper form's *structure* still matters is recognition: staff should meet the
same fields, in the same order, with the same grouping they already know. Preserve the
layout; standardise the words.

| Use | Not |
|---|---|
| Whole Blood | - |
| Packed Red Blood Cells (PRBC) | Packed cells, packed RBC, PRC |
| Platelet Concentrate: Random Donor Platelets (RDP) or Single Donor Platelets (SDP, apheresis) | Platelet |
| Fresh Frozen Plasma (FFP) | Plasma |
| **Cryoprecipitate** | Cryopresipitate, cryo |
| ABO group and RhD type: recorded as A+, A−, B+, B−, AB+, AB−, O+, O− | Rh factor, +ve / −ve |
| Indication for transfusion | Reason for transfusion |
| Date required | Date needed *(donor-facing copy still says "Needed by": plain language is right for donors)* |
| Pre-transfusion compatibility testing sample (crossmatch sample) | Blood sample |
| Donor health questionnaire | Screening questions |
| **Deferral**: temporary or permanent | Eliminated, rejected, banned |
| Inter-donation interval | Cooldown |
| Blood centre | Blood bank *(the term used in Indian regulation since the 2020 amendment; "blood bank" remains the colloquial equivalent)* |

Component naming should follow the national blood transfusion service's standard component
list; where components are labelled to ISBT 128, the label's component description is
authoritative. Confirm the exact list with the blood centre before the form is built. The
set above is the common case, not an exhaustive catalogue.

A regression test pins the label set, as before. The test now enforces the **standard**
wording, so a well-meaning edit toward a local variant fails the build in the same way a
misspelling would have.

### 2.8 Network-only clinical data

The app installs as a PWA and its shell works offline, but every data read and write
requires connectivity. Offline API calls fail loudly with an explicit connectivity message
rather than serving a stale record. There is no offline write queue. Stale clinical data is
worse than no data.

### 2.9 Audit

Every mutating action writes an audit event. Best-effort and non-blocking. An audit
failure must not fail the clinical action. The bot keeps its own append-only event log of
state transitions.

| Area | Audited |
|---|---|
| Auth | Sign-in success / failure / rate-limit, sign-out, invite sent and consumed, password reset requested and completed, password changed |
| Accounts | Account create, role change, activate / deactivate, update request submitted / approved / rejected |
| Clinical | Patient and admission creation and edit, seal update, draft create / update, submit, cancel, sample association |
| Centre: bags | Bag intake, issue, return and its outcome, discard, expiry |
| Centre, tags | Tag assign, release with reason, re-assign, retire, the append-only assignment history *is* this audit trail |
| Centre: vision | Calibration created / activated, region edited, reconciliation task raised and resolved, device registered / revoked |
| Donor | Consent given, re-recorded on edit, withdrawn; data deletion |

The centre's tag and return events carry the most weight: they are what lets someone answer
"which unit did this patient receive, and where had it been?" long after everyone involved
has forgotten.

### 2.10 Privacy

Nothing about the patient leaves the hospital. A donor sees blood group, hospital, units
and time, no patient name, no attender phone number. Donor contact details flow only to
the centre that raised the demand, and only for donors who confirmed. A volunteer admin sees
counts, never people.

### 2.11 The messaging channel is swappable

Telegram is the launch channel. WhatsApp is the expected successor, and the system must be
able to make that switch, or run both at once, without touching donor matching, the
questionnaire, wave logic, or the centre contract.

**Donor identity must not be a platform user id.** A donor gets an internal id, and
platform handles live in a separate table:

```
donor            (id, name, dob, weight, blood_group, location…, verified_phone)
donor_channel    (donor_id, channel, channel_user_id, opted_in_at, unique(channel, channel_user_id))
```

The verified phone number is what links a Telegram donor to the same person arriving on
WhatsApp. It is a verified attribute, never the primary key. People change numbers.

**Everything platform-specific goes behind one narrow port**, with one adapter per channel:

| Port operation | What it must express, in platform-neutral terms |
|---|---|
| `send_request_card` | A card: blood group, hospital, units, needed-by, plus Accept / Not this time |
| `update_card` | Replace a card's content in place, so a chat does not fill with duplicates |
| `ask_question` | One question, a fixed set of answers, an answer callback |
| `collect_multi_select` | A checklist the user toggles freely, then submits once: needed by the fix-several-answers flow in §5 |
| `request_phone` | Ask the platform for a verified phone number |
| `request_location` | Ask the platform for a location fix |
| `send_notice` | Plain text: confirmation, thank-you, reminder, stand-down |
| `deep_link(token)` | A shareable link that lands on a specific request |

**Where the two platforms differ**. Design for the harder one:

| | Telegram | WhatsApp Business Platform |
|---|---|---|
| Starting a conversation | Free, any time | Only via a **pre-approved message template**; free-form replies only inside the 24-hour window after the donor's last message |
| Buttons | Inline keyboards, freely | Interactive buttons and lists, with limits on count and label length |
| Editing a sent message | Yes: cards are edited in place | Effectively no; expect to send a new message and mark the old one stale |
| Identity | Numeric user id; phone shared on request | The phone number *is* the identity |
| Cost | Free | Priced per conversation |
| Onboarding entry | Deep link with a payload | Link with prefilled text, or a QR code |

Two consequences worth designing for from the start: a wave that reaches donors on WhatsApp
needs its **message templates submitted and approved in advance**, so donor-facing copy has
to be finalised earlier than it otherwise would be; and "edit the card in place" cannot be
assumed, so treat it as an optimisation the adapter may decline rather than a guarantee the
flow depends on. Verify current limits against the platform's documentation before
committing. The policy moves.

### 2.12 Scanned *and* counted: two instruments, one of them authoritative

Stock is known two ways, and the difference between them is load-bearing.

- **The tag reader is authoritative.** A scan identifies one specific bag and writes to the
  register: this unit, this group, this expiry, received now, issued to that request.
- **The camera is observational.** A capture reports how many objects are in a calibrated
  region, with a confidence. It is an **observation, not a fact**, and it never writes to
  the register.

Where they disagree, the register wins and a human is asked to look. That is the whole
trust model, and every consumer of stock numbers must be built for it. The value of the
camera is precisely that it sees what nobody scanned. See §4 for the mechanism, the
calibration screen, and the tag-collision workflows.

---

## 3. Module 1: Doctor app

### Concept

**A request slip, not a form.** The doctor gives four things, blood group, product, units,
urgency, and gets back an ID to read aloud to the patient's bystander, who carries it to the
blood centre. It replaces the paper form and the phone call.

Everything else about the request, the patient, the admission, the clinical context, the
crossmatch sample, is entered by the **blood centre** (§4), because a doctor handling
several patients at once is the wrong person to be typing an address, and the centre has a
counter with the bystander standing at it. The doctor's job ends at "submitted"; the centre's
answer comes back to the same screen. See [ADR 0010](adr/0010-the-doctor-app-becomes-a-request-slip.md).

### Target users

- **Doctors / house surgeons** in a medical-college hospital. The daily users. Mobile
  first, often at the bedside, on hospital wifi.
- **Hospital admins**. Provision and deactivate accounts, change roles, and work the
  account-update request queue. Occasional desktop users.

### Functionality

**Authentication and session**
- Email + password sign-in against admin-provisioned accounts.
- Server-issued session cookie: httpOnly, sameSite=lax, secure in production; the token is
  stored only as a hash.
- Login throttling per IP and per account, enforced in the database so it survives restarts
  and multiple instances.
- CSRF: every mutating request validates same-origin.
- **First sign-in** after an admin creates the account: the user arrives on the emailed
  single-use invite link and sets their own password there. The link is consumed on use;
  the account cannot sign in before that, and an expired link offers a re-send rather than a
  dead end. **Setting the password signs them in and lands them on the dashboard for their
  role**, never back on a sign-in form to type the password they just chose.
- **An invite that is never used** leaves the account visibly `pending activation` in the
  admin list, with its age. Invites do not silently rot: an account still unactivated after
  a configured period is surfaced for the admin to re-send or remove.
- **Password reset**, self-service, in four steps: enter the registered email → receive a
  6-digit OTP by email → enter it → set a new password. Rules that make it safe:
  - The response to "send me an OTP" is identical whether or not the address exists. A
    reset form must not become an account-enumeration oracle.
  - The OTP is stored hashed, expires in ~10 minutes, is single-use, and is invalidated by
    a successful reset, by a newer OTP, or by too many wrong attempts.
  - Attempts are throttled per account and per IP, sharing the login throttle mechanism.
  - A successful reset revokes every existing session for that account and writes an audit
    event. The user is emailed that their password changed.
  - The destination address is always the one on the account. It is never taken from the
    form.
  - **Where it ends**: a successful reset signs the user in and lands them on their
    dashboard. An expired or exhausted OTP returns to step one with a plain explanation and
    a way to request another, not a generic error. A user who abandons the flow mid-OTP is
    left exactly as they were, with their old password still working.

**Doctor profile and seal**
- Upload a signature seal (PNG only, ≤1 MB), re-encoded server-side before storage.
- **Seals go to object storage**, not to local disk. They are served only to the owning
  doctor or an admin, through an authenticated route, never by public URL.
- **Change my password** while signed in (current password required).
- **Request an account details update.** Fields a user must not silently rewrite, display
  name and provisional registration number, are read-only on the profile page with a
  *Request update* action beside them. The user submits the proposed value and a reason;
  the request lands in the admin queue as `pending`.
  - **The email address is not one of them.** It has the stronger flow above: a link
    delivered to the proposed address proves the person holds it, where an admin queue
    proves only that an administrator agreed, and both addresses are notified either way.
    Routing email through the queue as well would be a second, weaker path to the same
    change, which is the path an attacker would take (ADR 0012).
  - The user sees the status of their own requests (`pending` / `approved` / `rejected`,
    with the admin's note) and may withdraw one that is still pending.
  - Only one pending request per field per user.
  - On approval the change is applied by the system, not retyped by the admin, so what was
    reviewed is exactly what lands.
  - **Nobody decides their own request**, including an administrator. The queue exists so
    that a second person agrees, and a self-approval removes the only check in the flow.
  - Fields the user owns outright, phone number, department, are simply editable; the
    queue is only for identity fields.
  - **Every request reaches an end state.** Approved applies the change and notifies;
    rejected carries the admin's reason and the user may submit a corrected request;
    withdrawn closes it. A request nobody has touched ages visibly in the admin queue rather
    than sitting silently. The user asked a person for something, and silence is not an
    answer.

**Patients, admissions and clinical context. Entered by the blood centre**

**The doctor app is not where a patient is described.** A doctor at a bedside is handling
several patients at once; the centre has a counter, a person at it, and the patient's
bystander standing in front of them with the ID the doctor gave out. So everything about
the patient is Module 2's to collect, and §4 carries the detail:

- Identity and demographics, contact and address, clinical context, the admission under an
  `ip_no`, the search-and-de-duplicate warning before creating a record, and the
  crossmatch sample.
- The tables are unchanged (`patients`, `admissions`, `blood_samples`) and Module 1 still
  owns them. Only who fills them in has moved.

**Blood request, four fields and an ID**

This is the whole of what a doctor does.

| Field | How it is asked |
|---|---|
| **Blood group** | Eight buttons |
| **Product** | Whole Blood / Packed Red Blood Cells / Platelet Concentrate / Fresh Frozen Plasma / Cryoprecipitate (§2.7). **Stays with the clinician**: components are not interchangeable, and which one a patient needs cannot be inferred from a group and a count |
| **Units** | A number |
| **Urgency** | Emergency · Very urgent · Urgent · Routine |

There is no draft and no review screen: four fields on one screen are their own review.
Submitting allocates the ID, records the submit time, and makes the record immutable.

**Urgency, and the clock it runs on.** The doctor does not type a date. Each level derives
one, and each carries the time within which an answer is expected:

| Urgency | Needed by | Answer expected within |
|---|---|---|
| Emergency | today | 15 minutes |
| Very urgent | today | 1 hour |
| Urgent | today | 4 hours |
| Routine | in a week | - |

Three of the four land on the same date, which is the point: the difference between them is
how fast somebody walks, not what day it is. So the **centre queue orders by urgency**, then
by the derived date, then by submission time; and it shows **time since submission** against
the threshold above, flagging anything past it. A date alone would not notice an unanswered
emergency until midnight. Both the offsets and the thresholds are configuration (§12).

**The ID: `DDMMYY-NNNNN`.** Allocated at submit from a per-day counter (§7.1) and shown
back to the doctor large enough to read aloud. The doctor gives it to the patient's
bystander, who carries it to the blood centre; the date part is prefilled wherever it is
typed, so the counter enters five digits for a request raised today.

> **The ID identifies a request. It does not authenticate anybody.** It is short,
> sequential within a day and therefore guessable. That is safe at a counter, where a person
> is physically present and the centre verifies the patient by other means. It follows that
> **nothing keyed on this ID alone may ever be exposed publicly**, no status page, no API
> lookup, no "track your request" link. Anything of that kind needs a second factor.

**What the doctor sees afterwards.** Their own requests with the centre's decision, and,
if donors were recruited, live recruitment progress. Plus the one post-submit action they
have: **cancel**.

**How a request ends.** The happy path above is only one ending, and most requests leave by
another. Each needs a defined end state, because a request with no ending is a request the
centre keeps looking at.

| Ending | Who ends it | What happens |
|---|---|---|
| **Fulfilled** | The centre | Bags issued, decision recorded, the doctor sees it on the request view |
| **Partially fulfilled, donors recruited** | The centre, then the bot | The decision stands at `partial`; the shortfall lives on as a demand, and the request shows its progress until the demand closes |
| **Declined** | The centre | Recorded with a reason and visible to the doctor. A decline is an answer, not a dead end: the doctor can raise a fresh request, which is a new record rather than an edit of the old one |
| **Cancelled by the doctor** | The doctor | A submitted request can be **cancelled**: the patient improved, died, was referred, or it was raised in error. Cancelling releases any reserved bags, cancels an open donor demand (§5 stand-down), and requires a reason. It is the one post-submit action a doctor has, and without it the centre chases units nobody needs |
| **Nobody ever came** | The centre | The ID was never brought to the counter, so no patient was ever attached. It ages on the queue as **awaiting the bystander** and is closed by the centre with that reason: never silently |
| **Expired need** | The system | `date_required` passes with the request undecided: it stays visible and is flagged overdue on the centre queue rather than quietly ageing out. Nothing about a blood request should expire silently |

**Deciding before the patient is known. The emergency exception.** A request cannot
normally be reserved against or issued until the centre has attached a patient: blood
leaving a fridge has to be traceable to a named person, which is what §4's traceability and
the crossmatch sample both assume. **Emergency is the exception**, because waiting for a
bystander to arrive before releasing units is the worse failure. Three things keep it an
exception rather than a hole:

1. It applies to `emergency` only. Every other urgency needs the patient first.
2. The decision records that it was made against an unidentified patient, and by whom.
3. The request shows that visibly until a patient is attached, and the centre queue lists it
   as outstanding. An issued unit pointing at nobody is a debt, and it is shown as one.


**Dashboard**
- Live counts and a recent-requests table for the signed-in doctor: what each request was
  for, its ID, its urgency, how long it has been waiting, and the centre's answer when one
  comes. There are no drafts to resume. A four-field form is submitted or it never
  existed.

**Admin panel**
- Create accounts in every role, `doctor`, `admin`, `blood_centre`, `volunteer_admin`, list
  all accounts, change roles, activate and deactivate.
- **Creating an account sends the welcome email**: the username and the single-use invite
  link on which the user sets their own password (§2.3). The admin never sees, chooses, or
  can recover that password.
- **Re-send invite** for an account whose email never arrived, plus the delivery status of
  the last email sent to each account.
- **Account update request queue**: pending requests with the current value, the proposed
  value and the user's reason; approve (the system applies the change) or reject with a
  note that the person can act on. Oldest first, each showing how many days it has waited,
  because a request nobody rejects and nobody approves is the failure this guards against.
  An administrator's own request is shown without buttons and refused if submitted anyway.
- Authorization is checked at three independent layers, route protection, page guard, and
  a per-endpoint re-check, so no single mistake grants access.
- Safeguards: cannot change or deactivate your own account; cannot approve your own update
  request; the last active admin cannot be demoted or deactivated; minimum 12-character
  passwords; duplicate email or registration number rejected.

**PWA**
- Installable with a manifest and icons; app shell and public static assets cached; an
  offline fallback page. Authenticated documents, API responses and data payloads are
  network-only (§2.8).

### Data it owns

`users` (accounts in all four roles), `sessions`, `auth_rate_limits`, `password_reset_otps`,
`account_invites`, `account_update_requests`, `email_deliveries`, `patients`, `admissions`,
`blood_requests`, `blood_samples`, `blood_request_counters`, `audit_log`.

Ownership of the **tables** is unchanged by ADR 0010; what moved is who fills them in.
`patients`, `admissions` and `blood_samples` are now written by Module 2, and
`blood_requests.admission_id` is therefore null until the centre attaches one.

---

## 4. Module 2: Blood centre dashboard

### Concept

The other half of the loop. Every submitted request lands in a queue; the centre answers it
from physical stock, and whatever stock cannot cover becomes demand for real donors. It also
keeps every blood group above a stock floor, so recruitment happens before a crisis rather
than during one. The counter is the authority on what actually happened.

It is a role-gated section of the same web app, sharing auth, the design system and the
database client. Splitting it into its own deployment later should be mechanical.

### Target users

- **Blood centre technicians / counter staff**. The daily users. Desktop or tablet at the
  counter, working from a queue and a roster, with a tag reader at hand.
- **Blood centre in-charge**, sets hospital identity, the stock floor, and calibrates the
  cameras.
- **The tag reader**, attached to a signed-in workstation, or standalone with a device
  token. It identifies one bag at a time, deliberately.
- **The fridge camera**. A non-browser client with no session, authenticated by a device
  token. It writes observations and reads nothing.

### Functionality

**The request queue, and the counter that completes it**

Every request arrives with four fields and an ID (§3). The centre's first job is to turn it
into a record it can act on.

- **Ordered by urgency**, then by the derived date, then by submission time. A routine
  request raised on Monday must never sit above an emergency raised this morning.
- **Time since submission** against the threshold for that urgency, 15 minutes for an
  emergency, an hour, four hours, with anything past it flagged. That is the clock the top
  three urgencies actually run on; a calendar date would not notice an unanswered emergency
  until midnight.
- **Look up a request by ID.** The bystander reads out `090926-00001`; the date part is
  prefilled with today, so the counter types five digits.

**Patients and admissions. Entered here**

Moved from the doctor app by ADR 0010, with the bystander standing at the counter to answer:

- Identity and demographics: name, date of birth **or** age with unit (days / months /
  years, neonates matter, and a DOB is often unknown on admission), sex, blood group, and a
  hospital patient identifier (UHID/MRN) where one exists.
- Contact and address: attender name and phone, address, district, city.
- Clinical context carried with the patient rather than retyped per request: known
  diagnosis, relevant history, previous transfusion and any reaction to one, and the
  indication for this transfusion.
- Admit under an `ip_no`, the admission's identity and what the request references, with
  ward number and admitted/discharged timestamps.
- **Search and de-duplicate before creating**: a warning on a close name + age + group
  match, so one patient does not end up with three records across three admissions.
- Edits are permitted and versioned by snapshot rather than blocked, a request already
  answered keeps the values it was answered with (§2.6).
- **Attaching the patient completes the request**, snapshots the patient onto it, and is
  what unlocks reserving and issuing for every urgency except emergency.

**The crossmatch sample**, identifier (globally unique), collection time, and who recorded
it, is associated with the request here, alongside the patient.

**Inventory, two instruments, two different questions**

The tag reader and the camera are not alternatives. They answer different questions, and
the system is trustworthy only because it has both.

| | **Tag reader (RF / barcode)** | **Fridge camera** |
|---|---|---|
| Answers | **Which** bag: identity, group, product, collection, expiry | **How many** are physically present, per region |
| Scope | One bag, deliberately presented | A whole shelf, passively, continuously |
| Authority | **Authoritative**, it writes the register | **Observational**, it reconciles, never writes |
| Fires on | Intake, issue, return, discard | Door-close, and on a schedule |
| Catches | A bag's identity, expiry and chain of custody | A bag that moved **without anyone scanning it** |

That last row is the point of the pairing. The reader is exact but only sees what someone
remembers to present to it; the camera sees everything but knows nothing about it. Together,
the reader maintains the truth and the camera continuously checks whether the truth still
matches the shelf.

The pairing also makes the vision problem far easier than open-set recognition: the camera
never has to work out a blood group. The register already knows what *should* be in each
region, so the model only has to count objects in a calibrated area and compare against an
expected number.

**Inventory. The register**
- One row per physical bag, created when the bag is **received and scanned**: bag
  identifier, blood group, product, collection date, expiry date, source, and the tag
  currently assigned to it.
- Bag lifecycle: `available → reserved / issued / returned / quarantined / discarded /
  expired`.
- `reserved` means a bag is held for a specific request between the decision and physical
  collection. It is set when a decision issues bags and cleared when they leave the fridge
  or the decision is cancelled. A reserved bag counts as unavailable for any other request
  and is excluded from the stock floor.
- Add a bag by scanning its tag; edit its details; filter by group and status; discard and
  restore.
- The register is the **source of truth** for every decision. Which bag went to which
  patient, and when it expires, are facts that must be recorded per bag. A transfusion
  service has to be able to trace a specific unit to a specific recipient, and no camera
  provides that.

**A tag is hardware; a bag is a consumable. Model them separately.**

This is the decision that makes the collision cases below tractable rather than a mess of
special-casing. A tag's identifier belongs to a plastic object that outlives many bags:

```
rfid_tags          (tag_uid PK, status: unassigned | assigned | retired, current_bag_id?)
blood_bags         (id PK, unit/donation number, group, product, collected_at, expires_at, status)
tag_assignments    (tag_uid, bag_id, assigned_at, assigned_by, released_at, released_by, release_reason)
```

Scanning a tag resolves to *the bag currently assigned to it*. `tag_assignments` is the
history, and it is append-only. It is how you answer "what was on this tag in March?" after
the tag has been reused twice.

**Bag intake. Scan, then confirm**
- Scan the tag. If it is `unassigned`, the intake form opens.
- Enter or scan group, product, collection date, and source. **The expiry date is derived**:
  `collected_at + shelf life for that product`, from a configurable per-product table,
  prefilled and shown as a countdown. Where the bag arrives with an expiry printed on it,
  **the printed label wins**. The operator confirms against the bag in their hand, and a
  mismatch is flagged rather than silently accepted.
- The expiry clock runs from **collection**, never from intake or from a re-scan. A bag does
  not become fresher by being handled.
- On save: the bag is registered, the tag moves to `assigned`, and an assignment row opens.

**When a scanned tag is already assigned. The edge cases**

A tag that already exists is not one situation, it is three, and they must not share a
button. The screen resolves the tag, shows everything known about the bag currently on it,
group, product, collection, expiry, status, and if issued, to which request and when, and
then offers **only the actions valid for that status**.

| What the register says | What physically happened | The workflow |
|---|---|---|
| Bag is `issued` or `reserved` | **Case 1: the bag came back.** Surplus, or taken in error | **Return** |
| Bag is `issued`, `discarded`, `expired` or transfused, gone for good | **Case 2, the tag was reused** on a different bag | **Un-register, then re-register** |
| Bag is `available`, the register thinks it is on the shelf right now | **Neither.** Something is wrong | **Blocked**, raise a discrepancy |

**Case 1. Return.** The unit is a known bag coming back into the centre's custody.

- Record how long it was outside controlled storage and whether the cold chain was
  documented. That, not convenience, decides what happens next.
- Three outcomes, each explicit and audited: **Restock** (back to `available`),
  **Quarantine** (held pending a decision), or **Discard** (with a reason).
- **Quarantine is a waiting room, not a destination.** A quarantined bag is excluded from
  issue and from the stock floor, appears in its own list with the reason and how long it
  has been there, and must be resolved by a named person to `available` or `discarded`.
  Quarantined units age visibly; one unresolved past a threshold is escalated, and a
  quarantined bag that reaches its expiry is discarded automatically with that recorded as
  the reason. Nothing sits in quarantine indefinitely.
- **The expiry date is never recalculated on return.** It is a property of the donation, not
  of the bag's travels. Nor does a return re-open the request it was issued against. The
  centre decision stands, with the return recorded against it.
- Restocking a returned unit is a clinical judgement with a hard time limit in every
  transfusion SOP. Do not hard-code a threshold: read it out of the hospital's own SOP into
  configuration, default to **Quarantine** when the out-of-storage time is unknown, and let
  a named person make the call.

**Case 2. Un-register and re-register.** The tag was harvested off a spent bag and put on a
new one.

- **Un-register (release)** is only offered when the assigned bag is in a terminal state. It
  requires a reason and records who did it. The assignment row closes; the tag becomes
  `unassigned`.
- **Re-register (assign)** is only possible for an `unassigned` tag, and goes through the
  full intake form above. New bag record, its own collection date, its own derived expiry.
  It is a new bag, not an edit of the old one, and the old bag's history stays intact.
- The two steps are deliberately separate. A single "reassign" button invites someone to
  race past the question of what happened to the previous bag.
- **Tag retirement**: a tag that is damaged or reads unreliably is `retired` and can never be
  assigned again.

**Case 3. Blocked.** A tag presented as new, whose bag the register believes is sitting on
the shelf, means one of: the register is stale, two bags carry the same tag, or the tag is
cloned. Every one of those can put the wrong unit into a patient, so this case does **not**
offer a resolution button on the intake screen. It raises a discrepancy, names the
conflicting bag, and requires someone to physically locate that bag before anything
proceeds. This is the one place in the module where the right behaviour is to stop and make
a person go and look.

**But blocked is not the end of the flow**. It hands off to one, and the discrepancy must
be closable or the centre is left with a tag it cannot use and a task it cannot clear. The
open discrepancy sits on the dashboard with the conflicting bag's details, and resolves
exactly three ways, each requiring the resolver's identity and a note:

| What they found | Resolution |
|---|---|
| **The conflicting bag is on the shelf**: so this second bag is wearing a duplicate or cloned tag | The presented bag is quarantined and cannot be registered on this tag. The tag in hand is **retired**; the bag is re-registered on a fresh tag through normal intake |
| **The conflicting bag is not there**: it left without being scanned out | The register was wrong. The missing bag is marked `lost` with the note, which is a discard for stock purposes and a reportable event for the centre. The tag is then released and available to re-register |
| **The conflicting bag is there and this was a mis-scan**: wrong tag presented, or a mistaken intake | Dismiss the discrepancy. Nothing changes |

A discrepancy of this kind is never auto-resolved by a later scan, never expires, and stays
visible on the centre overview until a person closes it. It is the one alarm in this module
worth being loud.

**Inventory. The camera**

A camera inside the storage fridge observes what is physically on the shelves and reports
**counts per calibrated region**. It replaces the manual stock-take, not the register and
not the reader.

- **What it produces**: for each capture. A timestamp, a per-region count, a confidence per
  count, and a reference to the stored frame.
- **What it never does**: change the register. Vision *observes*; the reader and the decision
  flow *write*. An automatic decrement on a blurred frame is how a hospital comes to believe
  it has blood it does not have.
- **Reconciliation**: every capture is compared with what the register says should be in each
  region. Agreement is silent. A discrepancy opens a reconciliation task on the dashboard,
  group, expected, observed, the frame, and the recent scan history for that region, which
  a staff member resolves by correcting the register or dismissing the observation.
  Unresolved discrepancies surface on the centre overview, because a silent one is worse than
  none.
- **Capture triggers**: on fridge-door close (the shelf just changed), and on a schedule for
  drift. Not continuously. There is nothing to see between door events.

**Camera onboarding. The region calibration screen**

Before a camera counts anything, an admin teaches it what it is looking at. This is a
first-class screen, not a config file.

- **Draw the regions on a live frame.** The screen pulls a current image from the camera and
  the admin draws a rectangle or polygon over each shelf, tray or bin, labelling it with the
  blood group it holds, and optionally the product and an expected capacity.
- **Verify before activating.** A test mode runs the model against the live frame and
  overlays its count per region, so the admin sees what the camera will report *before* it
  starts raising tasks. Regions can be adjusted and re-tested until the counts look right.
- **Calibrations are versioned**, tied to the device, with the reference frame stored
  alongside. Every observation records which calibration version produced it, so historical
  counts stay interpretable after the shelving is rearranged.
- **Drift detection.** A nudged camera silently invalidates every region boundary while
  continuing to report confident nonsense. The worst failure mode this feature has. Each
  capture is compared against the calibration's reference frame; beyond a threshold, the
  device is marked **needs recalibration**, its observations stop being trusted, and the
  dashboard says so.
- Re-calibration is required after any camera move, lens clean, or shelving change, and the
  screen makes that a two-minute job rather than a ticket.

**Making the count work.** Counting deformable, overlapping, translucent bags in a cold metal
box is the hard part of this module, and the physical setup decides whether the model has a
chance:

| Problem | What makes it tractable |
|---|---|
| Reading a blood group off a bag in an image is unreliable | **Do not read the bag: read its position.** One shelf, tray, or bin per group, labelled and enforced, and calibrated as a region. The group comes from geometry, never from the pixels of the bag. This is by far the highest-leverage decision |
| Bags stack and occlude each other | Single-layer trays, or one camera per shelf. A count of a heap is a guess |
| Condensation, frost, low light | A sealed, heated-window enclosure rated for the storage temperature; lighting that switches on only for the capture and does not warm the contents |
| A metal box blocks radio | Prefer a wired run (power + data) through an existing gland. Validate signal before committing to wireless |
| The model is wrong sometimes | Report confidence, and treat low confidence as "no observation" rather than as a count of zero |
| Nothing to train on | Start in **shadow mode**: capture and predict, show the prediction beside the register's count, correct it, accumulate a labelled set from *this* fridge. Promote it to raising reconciliation tasks only once it agrees for a sustained period |

A cheap hedge worth taking: the tag label printed at intake can carry a **large,
high-contrast group marker** oriented toward the camera. It turns counting into detecting a
known symbol, and gives the camera a way to catch a bag sitting in the wrong region. The
one error that region-based counting is otherwise blind to.

- **Vision agent endpoint**: JSON in, JSON out, authenticated by a device token rather than a
  session (the camera has no browser). It submits an observation, counts, confidences, frame
  reference, calibration version, and reads back its configuration. Devices are registered,
  individually revocable, and their last-seen time is on the dashboard, because a camera that
  quietly stopped reporting looks exactly like a fridge that stopped changing.
- **Frames are clinical-area images**: retained briefly (days, not years) on a defined
  schedule, access-controlled, and framed to avoid capturing people at work.

**Request queue and decision**
- Every submitted request with the stock on hand for its group shown alongside, and anything
  past its needed-by date flagged overdue.
- Deciding a request is one transaction: lock the oldest available bags of that group
  (skip-locked so two staff members never contend for one bag), mark them issued to the
  request, record the decision (`approved` / `partial` / `declined` with units issued and a
  note), and, if there is a shortfall **and** the product is whole blood or packed red blood cells,
  raise a donor demand for the difference.
- Platelets, plasma and cryoprecipitate never recruit donors; they are not what a walk-in
  donor gives.
- One decision per request, enforced by a unique constraint in the database.

**Stock floor**
- A configurable minimum units per group (25 by default). "Recruit for groups below floor"
  raises one demand per group that is short and has no open floor demand already.

**Demand and roster**
- Every demand with live progress written back by the bot: donors notified, units confirmed,
  waitlisted, completed.
- The confirmed-donor roster, name and verified phone, for each demand.
- Mark each donor **Donated**, **No-show**, or **Cancelled**; optionally record the
  identifier of the bag collected from them, which is what links a donor to a unit.
- Record a **walk-in** donation from someone who never confirmed in the bot. The centre is the
  authority on who gave blood; getting a donor's interval right matters more than tidy state.
- Cancel a demand, which stands down every donor holding a unit for it (§5).

**Settings**
- Hospital name, address, district, city, snapshotted onto every demand, so this is what
  donors are told, the stock floor, and the per-product shelf-life table.

**Overview**
- Stock per group against the floor, requests awaiting decision, recruitment in progress,
  one-click recruit-for-floor.
- Open reconciliation tasks, ageing quarantined bags, unresolved tag discrepancies, and the
  health of every camera (last seen, last confidence, calibration state).

### Data it owns

`centre_settings` (single row), `blood_bags`, `rfid_tags`, `tag_assignments`, `bag_returns`,
`centre_decisions`, `product_shelf_lives`, `storage_devices`, `camera_calibrations`,
`calibration_regions`, `stock_observations`, `stock_reconciliations`, and it creates rows in
the two shared tables (§7).

---

## 5. Module 3: Donor bot

### Concept

The forwarded plea for donors, replaced by something that knows who is actually eligible. It
reads demand raised by the centre, works out which donors may give to that patient's group, and
messages them in waves. Stopping the instant the units are met, so no one travels to a
hospital that no longer needs them.

It is a separate always-on process: a chat adapter, an optional inbound HTTP API, and a
periodic ticker sharing one event loop. Nothing above the adapter knows which chat platform
it is running on (§2.11).

### Target users

- **Donors**. The public, on cheap phones, often in Malayalam-speaking Kerala districts.
  They are volunteers, not staff: every interaction has to be short and unambiguous. Some are
  pushed a request; some come looking on their own, and both paths have to work.
- **Volunteer admins**, trusted community members, whitelisted manually, who receive each new
  request as a card with a live counter and a forwardable message they can share into local
  groups, and who get the fuller picture in Module 4.
- **The blood centre**, indirectly, it raises demand and reads progress through Module 2, never
  through the chat platform.

### The three rules

**Eligibility is computed, never asked.** Blood-group compatibility (full ABO/Rh matrix, or
exact match when the centre demands it), reach within the location hierarchy, age 18–65, weight
at or above the configured minimum, inter-donation interval (90 days male / 120 female, per national
guidelines), an unresolved durable-screening flag, snooze and opt-out are all applied before a
message is sent, so every ping a donor receives is actionable. The predicate exists as SQL to
select a wave and as code to check one donor arriving on a deep link; a test asserts the two
agree.

**Buttons, not typing.** Every answer that can be a button is a button: blood group, sex, dates
on a grid, weight on a coarse scale, yes/no screening. The phone number comes from the
platform's own contact share, so it is verified rather than typed. Location is the one place
free text is unavoidable, and even there the donor picks from suggestions rather than spelling
a locality. A donor whose blood group has not been verified by staff is never matched.

**Nothing about the patient.** A donor card carries blood group, hospital, units and time.

### Functionality

**Donor onboarding**

The registration interview, in order. Every step is resumable: progress lives in the database,
not in process memory, so a restart or a donor who wanders off mid-signup is never stranded.

| # | Step | How it is asked |
|---|---|---|
| 1 | **Phone number** | Ask the platform for the contact. The donor taps to approve and the number arrives **verified**. Manual entry is the fallback (platform refusal, a shared device, a number different from the chat account) and is marked unverified until an OTP confirms it. On WhatsApp the number is already the identity: approve it rather than ask |
| 2 | **Name** | The one free-text field |
| 3 | **Date of birth** | Button grid: year, then month, then day. Gives age; age is never asked directly, because people round it |
| 4 | **Sex** | Buttons. Needed for the donation interval and to know whether the pregnancy screening question applies: not for display |
| 5 | **Blood group** | Eight buttons, plus "I don't know". Marked unverified until staff type the donor at a donation; unverified donors are never matched |
| 6 | **Weight** | Coarse bands as buttons (under 45 / 45–50 / 50–60 / 60–70 / 70+ kg), with the exact figure optional. Below the minimum threshold the donor is registered but not matched, and told plainly and kindly why |
| 7 | **Screening** | The durable questions only: see below |
| 8 | **Where you live** | District → city → town → locality, in that order: see below |
| 9 | **Last donation date** | Button grid, or "never". Sets the first inter-donation interval |
| 10 | **Review and acknowledge** | Every answer played back as a summary, each one correctable, then a single confirmation covering both *"these details are correct"* and *"message me when someone near me needs my group"*. Nothing is sent before this |

Entry is either from a shared deep link that lands on a specific request, or by finding the bot
directly. A donor arriving on a request link is onboarded first, then lands back on that
request. The link is never lost.

**Blood group and sex are not optional.** Group is the entire matching key; sex sets the
donation interval and decides whether the pregnancy question is asked. Without them a donor
cannot be matched at all.

**Screening is asked twice, and the two are different questions.**

| | At signup, *durable* | At each request, *temporary* |
|---|---|---|
| Asks about | Conditions that do not change week to week: chronic illness, permanent deferral conditions, weight below threshold | Fever now, medication now, a tattoo in the last N months, feeling well today, last meal |
| Effect of a disqualifying answer | Flags the profile for a human to review; the donor is not matched until it is resolved | Removes the donor from **this request only**; the profile is untouched |
| Why | These do not need re-asking every time, and asking them repeatedly reads as distrust | These are exactly the things that change, and the answer is only meaningful today |

Neither is a medical assessment. Both are a gate to stop a wasted trip; the real screening
happens at the counter. Nothing is ever phrased to the donor as a diagnosis or a verdict.

**Where you live, four levels, and how to fill them without typing**

The address hierarchy is district → city/taluk → town → locality. It exists so a wave can reach
the people closest to the hospital first, which is the single biggest lever on whether someone
actually turns up.

Two paths, offered in this order:

1. **From their location.** Ask the platform for a location fix; the donor taps to share.
   Reverse-geocode it, prefill all four levels, and **show them for confirmation**:
   "Kozhikode › Kozhikode › Feroke › Karuvanthiruthi. Is that right?", with per-level
   correction.
2. **By choosing.** District from a list. Then city, town and locality each as a type-ahead
   filtered by the level above, so the donor types two or three characters and picks. Free text
   is accepted only as a last resort and lands in a review queue rather than silently creating a
   new place.

This needs a **reference dataset of the hierarchy**, seeded and versioned, with the app matching
against it rather than storing whatever was typed. Locality names in Kerala have several
romanised spellings each, and a donor pool keyed on free text cannot be sorted by proximity.
The same place will appear four ways. Store the matched reference id and the donor's own wording
alongside it.

Two things to plan for: reverse geocoding is **routinely accurate to the town and frequently
wrong at the locality level** in Indian towns, which is why step 1 confirms rather than accepts;
and a donor's district can change, so this must be editable later without redoing signup.

**Step 10. The summary**

The last screen plays back everything the donor has said, in one message, and asks them to
confirm it all at once:

```
Please check these details:

  1  Name             Anitha Rajan
  2  Phone            +91 98••• ••210  (verified)
  3  Date of birth    14 Mar 1996  (age 29)
  4  Sex              Female
  5  Blood group      B+  (to be confirmed by staff at your first donation)
  6  Weight           50–60 kg

  7  You told us:
       No long-term illness or medication          ✓
       Not currently pregnant or breastfeeding     ✓
       Never been advised not to donate            ✓

  8  Where you live   Kozhikode › Kozhikode › Feroke › Karuvanthiruthi
  9  Last donated     22 Feb 2026. You can donate again from 23 May 2026

  [ Fix something ]   [ Yes, this is correct. Send me requests ]
```

- **The durable screening answers appear here, in the donor's own terms**, not as a hidden
  score. Someone who mis-tapped a yes/no three screens ago finds out now rather than by being
  silently excluded from every request for a year, which is exactly how a donor pool quietly
  rots.
- **One confirmation covers both things**: that the details are correct, and that the donor
  agrees to be messaged. They are inseparable in practice. Consent to be contacted about a
  blood group is meaningless if the blood group is wrong.
- Derived consequences are shown as consequences, not as raw data: an age from the date of
  birth, a next-eligible date from the last donation. A donor should leave signup knowing when
  to expect to hear from us.
- The phone is masked in the playback. The donor knows their own number; anyone reading over
  their shoulder does not need it.

**Fixing things, all of them, in one pass**

If someone got three answers wrong, they should fix three answers once, not make three round
trips through the summary. Two ways in, and neither is a restart:

- **Jump straight to one field.** Every row is numbered. Tapping a numbered button, or replying
  `5`, goes directly to that question, re-asks it with its original input control, and returns
  to the summary.
- **Fix several at once.** *Fix something* opens a **checklist of every field**. The donor taps
  each one that is wrong; the ticks accumulate and the list stays open. Then *Fix these (3)*
  walks through only the ticked fields, in the order they appear in the summary, and comes back
  to the summary **once** at the end.

```
  Which ones need fixing?

   ☐ 1  Name              ☑ 5  Blood group
   ☐ 2  Phone             ☐ 6  Weight
   ☑ 3  Date of birth     ☑ 7  Screening answers
   ☐ 4  Sex               ☐ 8  Where you live
                          ☐ 9  Last donated

  [ Fix these (3) ]   [ Cancel ]
```

Rules that keep it from becoming a maze:

- **The re-ask is the original question, unchanged**. The same buttons, the same date grid, the
  same location type-ahead. There is no second, lesser edit interface to build or to maintain.
- **Editing one field never invalidates the others.** The only exception is location: changing
  the district resets the levels beneath it, because a town in the old district is meaningless
  in the new one, so that edit continues down the chain rather than stopping.
- **Screening (7) re-asks the whole short set**, not one question. Which question was wrong is
  exactly what the donor cannot see from the summary, and the set is only three or four taps.
- **The returned summary marks what changed**, *"updated"* against each edited row, so the
  donor can confirm the fix landed rather than re-reading everything.
- **Nothing is committed until the final confirmation.** Edits accumulate against the in-progress
  registration; abandoning the flow leaves the donor exactly where they were.
- **Start again** exists, as an escape hatch, but is never the only way out of a mistake.
- **Channel note**: this needs the `collect_multi_select` port operation (§2.11). Telegram does it
  with a toggling inline keyboard. WhatsApp's interactive lists cap rows per section and buttons
  per message, so its adapter renders the numbered list and accepts `3, 5, 7` as a reply. The
  flow above is written so both work.

**Where signup ends.** The confirmation is not the last thing the donor sees; it is the point at
which they need to know what happens next.

- **Came in on a request link** → straight back to that request card, screening included if they
  qualify. That is what they came for.
- **Came in on their own** → a short close: they are registered, this is when they next become
  eligible, and this is how to see what is needed right now (the demand board). Not a silent end.
- **Registered but not matchable**, unverified blood group, under the weight threshold, an
  unresolved durable-screening flag, or still inside their inter-donation interval, → told plainly which it is,
  what would change it, and that they stay on the list. This is an ending, not a rejection, and
  the wording carries the difference.
- **Declines the acknowledgement** → the registration is kept but dormant: no messages are sent,
  and they are told in one line how to turn it on later. A donor who says "not now" has not said
  "delete me", and making them retype everything if they change their mind loses them twice.
- **Abandons partway** → their progress is held. One gentle reminder, once; then silence. Nothing
  is deleted, and returning drops them back on the question they stopped at.

**This same screen is the donor's profile editor.** Donor self-service reopens the identical
summary with the identical checklist; there is one implementation and two entry points. That is
also why the acknowledgement is re-recorded whenever details change. The donor is agreeing to the
summary in front of them, not to a form they filled in months ago.

**Consent, and the right to withdraw it.** That confirmation is what makes every later message
lawful, so record it properly: the timestamp, the version of the wording shown, and a snapshot of
the summarised values the donor was agreeing to. "They consented" is not evidence; "they consented
to *this text*, showing *these values*, at *this time*" is.

A donor must be able to pause messages, opt out, and delete their data from inside the chat, in one
or two taps, without contacting anyone. The consent copy needs legal review before real donors are
enrolled. It is health-adjacent personal data (§12).

**Demand intake**
- A ticker (every 60s by default) imports open demand rows the centre has raised and creates a request
  card. Import is idempotent. The demand id is the external key, so a row is never fanned out twice.
- A signed HTTP API (HMAC-SHA256 over `timestamp.body`, per-centre secret, the timestamp signed to
  prevent replay) is the alternative path, for an external blood centre that cannot share the database.
  Requests carry a centre id from day one so multi-tenant is not a retrofit.

**Wave distribution**
- 20 eligible donors per wave, another wave every 30 minutes until the units are met, ordered by
  **proximity down the location hierarchy**, same locality, then same town, then same city, then
  same district, and within each tier, longest-since-donation first. The four levels collected at
  signup exist for exactly this ordering; a wave that only knew the district would wake half a city
  for a hospital two streets away.
- The next wave time is a column polled by the ticker, not an in-memory timer, so a restart
  mid-request resumes escalation.
- Every volunteer admin gets a card with a live counter and a forwardable message, and can open the
  dashboard in §6 for the whole picture.
- A donor is pushed a request **only** when their verified group is compatible, they are within
  reach, they are past their inter-donation interval, and they have acknowledged step 10 of signup. Push is the default
  path. The donor should not have to go looking.

**Browsing demand, for the donor who comes looking anyway**

Not everyone waits to be asked. Some people want to give because they read something, or because a
friend needed blood last month, and they open the bot on their own.

- **Live demand, open to everyone**. Registered or not, eligible or not. A simple list of what is
  currently needed: blood group, hospital, town, units still outstanding, needed-by. No patient
  details, exactly as elsewhere (§2.10).
- **My matches first.** For a registered donor the list leads with the requests they actually qualify
  for, marked as such, and shows the rest below. Tapping a match enters the same accept → screen →
  confirm flow as a pushed request; there is one path, not two.
- **A visitor who taps a request they are not registered for** is onboarded first and then returned
  to it. The same behaviour as a deep link.
- **When a donor does not qualify, say why, once, without a lecture**: still in the inter-donation interval
  until a date, wrong group for this request, too far. A donor who understands why they were skipped
  stays; one who feels ignored leaves.
- The board is reachable from a chat command, from the deep link, and as a public web page (§6) that
  anyone can share.

**The donor journey** (one row per donor per request)

```
NOTIFIED ─Accept─▶ ACCEPTED ─▶ SCREENING ─pass─▶ CONFIRMED ─▶ COMPLETED
    │                              │                  │
    └─Not this time─▶ DECLINED     │                  ├─▶ CANCELLED / NO_SHOW
                                   └─fail─▶ DEFERRED (this request only)
                     units already met ─▶ REQUEST_FILLED (waitlist)
```

- **Donor health questionnaire**: six yes/no questions. A hard gate to stop a wasted trip, never a
  medical assessment; the full pre-donation assessment always happens on site. A disqualifying answer
  **temporarily defers** the donor *from this request only*; temporary conditions never touch the
  donor profile. An answer suggesting a **permanent deferral** raises a review flag for a human, and
  nothing is ever phrased to the donor as a medical verdict. Deferral is the standard term and the
  one to use in donor-facing copy: it is accurate, it is temporary by default, and it does not read
  as a judgement of the person.
- **Confirmed** donors receive hospital, address and time. A donor who accepts a just-filled request
  is waitlisted rather than made to answer six questions for a place that no longer exists.
- Cards are edited in place rather than re-sent, where the platform allows it, so a donor's chat does
  not fill with duplicates.

**Every donor who was told something gets told how it ended.** A donor who was asked to do something
and then hears nothing is a donor lost.

| State they are in | What must reach them, and when |
|---|---|
| `NOTIFIED`, request fills without them | One line: it is covered, thank you, nothing to do. The card stops offering Accept |
| `REQUEST_FILLED` (waitlisted) | Either **promoted**, a slot reopened, here is the hospital and time, or **stood down** when the request closes. A waitlist that never resolves is worse than never offering one |
| `CONFIRMED`, demand **cancelled** by the centre | Stand down immediately and unmistakably. This is the single most important message the bot sends: someone is otherwise about to travel to a hospital that no longer needs them |
| `CONFIRMED`, need **expires** unmet | Same stand-down, with thanks. The unit is released and the interval is untouched: they did not donate |
| `CONFIRMED`, donor does not appear | Marked `NO_SHOW` at the counter. No accusatory message; they stay eligible |
| `DEFERRED` by screening | Told it applies to this request only, and that they will be asked again next time |
| `COMPLETED` | Thank-you, inter-donation interval rolled forward, and the date they next become eligible |

**Completion**
- The centre's counter marks flow back: `Donated` rolls the donor's inter-donation interval forward and sends the
  thank-you; when every unit is in, the demand closes. `Cancelled` releases the unit so the waitlist
  can be promoted.
- Progress counters are written back for the centre dashboard on every change.
- **A demand closes exactly one way of four**: `completed` (every unit collected), `cancelled` (the
  centre withdrew it, including because the doctor cancelled the request), `expired` (the date passed
  unmet), or `fulfilled` then `completed`. Whichever it is, the closure fans out the stand-down
  messages above and stops recruitment in the same pass. Closing a demand without telling the people
  holding units for it is the one failure this system must not have.

**Donor self-service**
- View and edit the profile through **the same summary and the same fix-several checklist used at
  signup**. District, city, town, locality, phone, blood group (re-flagged unverified on change),
  weight, last donation date, durable screening answers. Saving re-records the acknowledgement
  against the values shown.
- **Snooze** for a chosen period, **opt out** entirely, and **delete my data**, each reachable in one
  or two taps from the chat, not by writing to anyone. Each has a stated end: snooze names the date it
  lifts, opt-out says how to come back, deletion confirms what was removed.
- **Deletion, honestly.** The donor profile, chat identity, contact details, location and screening
  answers are deleted. What cannot be deleted is the record that a specific unit of blood came from a
  specific person on a specific date, that belongs to the blood centre, not to the bot, and a
  transfusion service has to be able to trace a transfused unit back to its donation. Those rows are
  **de-identified**, keeping the donation and the bag identifier while dropping the name and number.
  - Say this in the confirmation, before deleting, in one sentence, not in a policy page.
  - A donor who never donated has nothing retained, and should be told so.
  - The retention basis needs the same legal review as the consent copy: it is a lawful-obligation
    exception asserted against a deletion right, and an engineer should not be scoping it (§12).
- See their own history: requests they were notified about, accepted, and donated for, and the date
  they next become eligible.

**Volunteer admin tools**
- Manual whitelist, optionally scoped to a district (no district = every district).
- Live request cards in chat, and the forwardable message.
- A link into the volunteer dashboard (§6) for anything that is a picture rather than a notification.

**Operational**
- A diagnostic command that checks channel credentials, network, database and port and says what to do
  about each failure.
- Synthetic donor seeding for testing, using ids that can never collide with real users.
- Every donor-facing string in one resource file with a per-donor language column. On WhatsApp these
  strings are also what gets submitted for template approval, so they need to be settled early.

### Data it owns

`donors`, `donor_channels` (§2.11), `donor_consents`, `bot_requests` (the bot's own view of a
demand), `donor_requests` (the journey rows), `admins`, `admin_cards`, `conversation_state`,
`event_log`, and the seeded `location_hierarchy` reference, all in its own schema.

### Two concurrency details that decide correctness

**The last unit.** Claiming a unit is a single conditional UPDATE guarded by
`confirmed_count < units_needed`. Two donors finishing screening at the same instant contend on one
row: exactly one UPDATE matches, so one is confirmed and the other waitlisted. It must not be a
read-then-write.

**Replayed taps.** Every chat platform redelivers callbacks. Every transition is a conditional UPDATE
guarded on the status it expects and reports whether it actually moved; a replay matches nothing and
is a no-op. Questionnaire progress lives on the journey row rather than in session memory, so a
duplicate tap is caught by comparing the tapped question index against the answers already recorded,
and the flow survives a restart.

---

## 6. Module 4: Volunteer dashboard

### Concept

One screen that answers "what is needed right now?" at a glance. A chat card tells a volunteer about
one request; it is a poor way to see eight blood groups at once, and volunteers are the people who
decide where to point a community's attention. This is that view, and nothing more.

### Target users

- **Volunteer admins**. Community organisers, blood-donor group coordinators, student volunteers. On
  a phone, often mid-conversation, deciding which group to push today.

### Functionality

**The primary view is the blood groups.** Eight tiles, one per group, each showing the state of that
group at a glance: units outstanding right now, donors confirmed against them, and whether the group
is below the stock floor. The tiles are the navigation. Tap one to see the open demands behind it.

- **Colour-coded by pressure**, not by decoration: met / recruiting / short / critical. The colour
  must survive being read on a cheap phone in daylight, and must never be the only signal. Pair it
  with the number and a label.
- **Live**, without a refresh button. Polling is fine; the numbers move on the scale of minutes.
- Behind a tile: each open demand, hospital, town, units outstanding, needed-by, donors notified and
  confirmed, and the forwardable message for it, with a copy button.
- **A share sheet per group**: a ready-made message a volunteer can paste into a community group,
  generated from live numbers so it is never stale.
- Optionally scoped to the volunteer's district, matching the scoping on their chat whitelist.
- **Trend, lightly**: units met vs missed over the last few weeks per group, so a volunteer can see
  whether the effort is working. This is the only place aggregate history is shown.

**What a volunteer must never see here**: a patient name, a request's clinical detail, a doctor's
identity, a donor's name or phone number. The dashboard is counts and hospitals. If a screen needs a
person's name to be useful, it belongs in Module 2, behind the centre role.

**A public version of the same board**, with the sharing tools and district scoping removed, is the
web face of the donor-facing demand list in §5, one page anyone can open or forward, no account
needed.

### Data it owns

None. It reads the shared demand tables (§7) and the bot's progress counters.

---

## 7. The contract between the modules

Two tables in the hospital schema. The bot never creates them; the web app's migrations do.

### `donor_demand`: centre → bot

| Written by | Columns | Meaning |
|---|---|---|
| Centre | trigger (`request_shortfall` / `stock_floor`), blood request id, blood group, product, units, date required | What is needed |
| Centre | hospital name, address, district, city, notes | Snapshotted from settings; what donors are told |
| Both | status | Centre: `open → cancelled`. Bot: `open → fulfilled → completed / expired` |
| Bot | bot public id, imported at | Set once imported; the public id is the deep-link id |
| Bot | confirmed / waitlisted / completed units, donors notified | Live progress for the dashboard |

The bot polls for `status = 'open' AND bot_public_id IS NULL`.

### `donor_demand_confirmations`: bot → centre → bot

| Written by | Columns | Meaning |
|---|---|---|
| Bot | demand id, donor id, channel, donor name, donor phone, blood group, confirmed at | A donor who passed screening and holds a unit: the roster |
| Both | status | Bot: `confirmed`. Centre: `completed` / `no_show` / `cancelled` |
| Centre | donated at, bag identifier, marked by | What happened at the counter |
| Bot | acknowledged at | Set once the donor has been updated and thanked |

`(demand id, donor id)` is unique. The key is the bot's **internal donor id**, not a platform user
id. That is what lets the same person be reached on one channel today and another tomorrow without
the centre's roster changing shape (§2.11). The channel is carried alongside so the counter knows where
the person was reached.

### `walk_in_donations`: centre to bot, one way

| Written by | Columns | Meaning |
|---|---|---|
| Centre | demand id, donor name, donor phone, blood group, bag identifier, donated on, recorded by | Somebody who gave without ever being in the bot |
| Bot | - | It reads and writes nothing here |

Added in contract 1.2.0, and a separate table rather than a confirmation row because the centre
holds **no INSERT** on `donor_demand_confirmations`: the bot creates the roster, the centre records
what happened at the counter, and a centre that could invent confirmations could inflate counters
the bot owns. The bot reads this because a unit already collected is a unit it must stop recruiting
for. Otherwise a demand covered by walk-ins goes on calling real people in for blood the shelf
already has.

### Dates

The centre records a **day**. Donors are told "Needed by Sun 7 Sep" and the request expires at 23:59
local time that day. API-originated requests keep their exact time.

---

## 8. Flow index: every flow's way in and ways out

One row per user flow, so nothing is built with an entrance and no exit. The rule this table
enforces: **every flow ends somewhere named, including when it goes wrong, and whoever was left
waiting is told.** ⚠︎ marks the endings that are easiest to leave unbuilt, because they fire on paths
nobody demonstrates.

**Drafts are not in this table any more.** ADR 0010 removed them: a four-field form is submitted
or it never existed, so "draft abandoned → ages on the dashboard" describes a state that can no
longer occur. What replaced it is the row below it. A request whose ID nobody ever brings to the
counter, which ages there instead.

### Module 1: doctor and admin

| Flow | Way in | Ways out |
|---|---|---|
| Account activation | Admin creates account → invite email | Password set → signed in on their dashboard · link expired → re-send · ⚠︎ never activated → ages visibly in the admin list |
| Password reset | "Forgot password" on sign-in | Reset → signed in · ⚠︎ OTP expired or exhausted → back to step one with a way to retry · abandoned → old password still works |
| Account update request | *Request update* on the profile page | Approved and applied · rejected with a reason, resubmittable · withdrawn · ⚠︎ untouched → ages visibly in the admin queue |
| Patient → admission | The blood centre counter (§4), or the doctor's optional section | Patient recorded; admission open until discharged |
| Blood request | Four fields on the doctor's one screen | Submitted → decided by the centre · ⚠︎ cancelled by the doctor with a reason · ⚠︎ need date passes undecided → flagged overdue, never silently aged out · ⚠︎ nobody ever brings the ID in → ages on the centre queue as *awaiting the bystander* |
| Completing a request | The bystander arrives with the ID | Patient attached → the request can be answered · ⚠︎ answered first under the emergency exception → shown as outstanding until completed |
| Sample association | The submitted request's view | Sample recorded against the request |
| Seal upload | Profile | Stored, or rejected with the reason (type, size) |

### Module 2: blood centre

| Flow | Way in | Ways out |
|---|---|---|
| Bag intake | Scan an unassigned tag | Registered and `available` · abandoned before save → nothing written, tag still unassigned |
| Scan hits an assigned tag | Any scan | Return (case 1) · un-register → re-register (case 2) · ⚠︎ blocked (case 3) → a discrepancy that closes exactly three ways |
| Bag return | Case 1, or a bag handed back at the counter | Restocked · ⚠︎ quarantined → *must* later resolve to available or discarded · discarded with a reason |
| Tag re-use | Case 2 | Released → re-registered as a new bag · tag retired if unreliable |
| Case 3 discrepancy | Case 3 | ⚠︎ Duplicate tag → retire it · ⚠︎ bag missing → marked lost · ⚠︎ mis-scan → dismissed. Never auto-resolves, never expires |
| Request decision | The submitted-request queue | Approved · partial + demand raised · declined with a reason · ⚠︎ overdue if the need date passes first |
| Stock-floor recruitment | *Recruit for groups below floor* | Demand raised per short group, or nothing if none are short |
| Camera calibration | Admin opens the calibration screen | Activated after a verified test run · ⚠︎ drift detected → "needs recalibration", counts distrusted until redone |
| Reconciliation task | A capture disagrees with the register | Register corrected · observation dismissed · stays open and visible until one of the two |
| Donor roster marking | The demand page | Donated · no-show · cancelled → unit released · walk-in recorded |

### Module 3: donor bot

| Flow | Way in | Ways out |
|---|---|---|
| Onboarding | Request deep link, or finding the bot | Back to the request they came for · registered, with the next-eligible date and the demand board · registered but not matchable, told which and why · ⚠︎ acknowledgement declined → dormant, reversible · ⚠︎ abandoned → held, one reminder, resumable |
| Fix answers at review | *Fix something*, or a numbered row | One field fixed → summary · several fixed in one pass → summary with changes marked · cancel → summary unchanged |
| Being notified | A wave, or browsing the board | Accept → screening · decline · ⚠︎ request fills without them → told it is covered |
| Screening | Accepting a request | Pass → confirmed, with hospital and time · pass but full → waitlisted · fail → temporarily deferred from this request only, told it does not affect the next one |
| Waitlist | Passing screening on a full request | ⚠︎ Promoted when a slot reopens · ⚠︎ stood down when the request closes. Never left hanging |
| Confirmed donor | Passing screening | Donated → thanked, interval rolled forward, next-eligible date · no-show → no message, still eligible · ⚠︎ demand cancelled or expired → **stood down immediately** |
| Profile edit | Chat menu | Saved and re-acknowledged, via the same summary as signup |
| Snooze / opt out / delete | Chat menu | Snoozed until a named date · opted out, reversible · ⚠︎ deleted, with donation records de-identified rather than removed, and said plainly first |
| Browsing demand | Chat command, link, or the public page | Into the accept flow · told why they do not qualify · nothing, which is a valid ending |

### Module 4: volunteer dashboard

| Flow | Way in | Ways out |
|---|---|---|
| Viewing demand | Sign-in, or a link from a chat card | Read-only; a share message copied out. No state to leave behind |

---

## 9. Role and surface matrix

| Surface | Anonymous | doctor | admin | blood_centre | volunteer_admin | Device token | Donor (chat) |
|---|---|---|---|---|---|---|---|
| Landing, sign-in, offline | yes | yes | yes | yes | yes | - | - |
| Public demand board | yes | yes | yes | yes | yes | - | yes |
| Password reset (OTP) | yes | yes | yes | yes | yes | - | - |
| Dashboard, patients, admissions, requests, samples | no | yes | yes | no | no | - | - |
| Own profile, change password, request update | no | yes | yes | yes | yes | - | - |
| Admin panel, update-request queue | no | no | yes | no | no | - | - |
| Centre inventory / requests / demand / settings | no | no | yes | yes | no | - | - |
| Volunteer dashboard | no | no | yes | no | yes | - | - |
| Camera calibration screen | no | no | yes | yes | no | - | - |
| Camera observation / tag reader endpoint | no | no | no | no | no | yes | - |
| Donor onboarding, request cards, screening | - | - | - | - | - | - | yes |
| Volunteer admin chat cards | - | - | - | - | - | - | whitelist only |

---

## 10. Non-functional requirements

- **Design system**: system light/dark themes, 48px minimum touch targets, 52px inputs, tabular
  numbers, single-column forms, one filled primary action per screen, mobile bottom navigation →
  tablet rail → desktop sidebar, safe-area padding for standalone mode. Malayalam-capable font
  fallback. Amber validation, neutral offline messaging, no invented urgency.
- **Deployment shape**: the web app is stateless and horizontally scalable behind managed PostgreSQL.
  The bot is a single always-on process; on a long-polling channel it needs **no public surface** at
  all, reaching the platform by polling and the centre by writing rows, and only one copy may run per
  bot token. **A webhook-delivered channel changes this**, the bot gains a public HTTPS endpoint with
  signature verification, and the deployment target must hold a stable public URL.
- **External dependencies**, each needing an owner and a failure story: a transactional email
  provider (§2.4), a reverse-geocoding provider, a seeded location-hierarchy dataset, object storage
  for seals, the tag readers and their label printer, the in-fridge camera hardware and its model,
  and, for a WhatsApp channel, a Business account with approved templates.
- **Every one of those can be unavailable**, and the system keeps working when they are. The centre
  must be able to register and issue a bag by typing its identifier when a reader fails; the camera
  going dark degrades to "no observations", never to "zero stock"; a failed reverse geocode falls
  through to the type-ahead; an undelivered invite is re-sendable. None of these is an outage of the
  loop in §1.
- **Licence**: **Apache License 2.0**. See §12.7 for why, and for the alternative if the goal
  changes.
- **Medical disclaimer**: not medical advice, not clinically validated, not for real clinical use
  without institutional validation, security review, compliance review and authorization. This is
  separate from the licence and is not satisfied by it, §12.6 explains why it is a working
  constraint on the copy and not a footer.
- **Engineering standards**, module boundaries, the stack, coding rules, testing and CI: §11.
  **Legal and regulatory obligations** and what they demand of the build: §12.

---

## 11. Engineering standards: how to keep this changeable

The requirement is that a change three years from now is cheap. That is not achieved by choosing good
libraries; it is achieved by deciding, in advance, **which parts are allowed to know about which
other parts**. Everything below serves that.

### 11.1 The dependency rule

One rule, and every module boundary follows from it:

```
        adapters                    application                 domain
  ┌────────────────────┐      ┌────────────────────┐      ┌──────────────────┐
  │ HTTP routes        │      │ Use cases:         │      │ Pure rules:      │
  │ Database repos     │ ───▶ │  submit request    │ ───▶ │  ABO/Rh matrix   │
  │ Chat adapters      │      │  decide request    │      │  eligibility     │
  │ Vision device API  │      │  register bag      │      │  screening gate  │
  │ Email, geocoding   │      │  onboard donor     │      │  state machines  │
  └────────────────────┘      └────────────────────┘      └──────────────────┘
        knows everything            knows domain              knows nothing

  Dependencies point inward, only. The domain does not import a framework,
  a driver, an HTTP type, or a platform SDK, and can be tested without any.
```

- **The domain is pure and boring**: blood-group compatibility, the eligibility predicate, the
  screening gate, the request/demand/donor state machines, expiry arithmetic. No I/O, no clock reads
  (time is passed in), no randomness. These are the rules that must not change when the stack does,
  and they are the rules a reviewer with a medical background can actually read.
- **Adapters are replaceable by definition.** One chat platform → another, one camera vendor →
  another, one email provider → another, one ORM → another: each is one directory and one interface.
  The channel port in §2.11 is the model for all of them.
- **Use cases are the only place a transaction is opened**, so "what happens atomically" is legible in
  one file rather than scattered across routes.

### 11.2 Module boundaries, enforced by the build

A convention nobody can violate accidentally is worth ten in a style guide.

- Every module has a **public entry point**; everything else is private. Deep imports
  (`module/internals/thing`) fail the build. Enforced with an import-boundary lint rule in CI, not by
  review.
- **No module reads another module's tables.** The doctor app does not query centre tables; the centre
  does not query the bot's schema. Cross-module data moves through a published interface or through
  the two shared tables in §7, and nothing else. This is what makes Module 2 or 4 splittable into its
  own deployment later without an archaeology project.
- **The shared contract is a versioned package** that both sides depend on, with contract tests each
  side runs. A change to `donor_demand` that only one side knows about is the single most likely way
  this system breaks in production.
- **Feature flags for anything phased**: vision shadow mode, a second chat adapter, the public demand
  board. A half-built adapter behind a flag is fine; a long-lived branch is not.

### 11.3 Tech stack: what is fixed, what is not

| Layer | Choice | Fixed? |
|---|---|---|
| Database | PostgreSQL | **Fixed.** Row-level locking, `FOR UPDATE SKIP LOCKED`, transactional counters and schema separation are all load-bearing (§4, §5) |
| Web app (Modules 1, 2, 4) | TypeScript, a React meta-framework with server-side routing | Framework replaceable; **TypeScript is not** |
| Schema and migrations | A migration-based schema tool | Tool replaceable; **"migrations only, never auto-create"** is not |
| Validation | A schema validator at every boundary | Library replaceable; **validating at the boundary** is not |
| Bot | See below | Open decision |
| Vision inference | Python | Fixed by the ecosystem |
| Styling | Utility CSS + design tokens | Replaceable |

**The one open stack decision: what language the bot is written in.**

| | Python | TypeScript |
|---|---|---|
| For | Mature chat-bot libraries; the same language as the vision service | **One domain package, shared by web and bot.** Blood-group compatibility and the eligibility predicate exist once instead of twice |
| Against | The eligibility rules end up implemented twice, once for the web app, once for the bot, and every rule change is two changes in two languages | A smaller chat-platform library ecosystem |

**Recommendation: TypeScript for the web app and the bot, Python only for vision inference** (behind
the HTTP device API in §4, so it is an adapter like any other). The deciding argument is not language
preference. It is that blood-group compatibility and donor eligibility are *clinical rules that must
never disagree between two implementations*, and the surest way to guarantee that is to have one
implementation. If the bot is written in Python, the predicate needs a single source of truth
generated into both languages, and the agreement test becomes mandatory rather than nice to have.

### 11.4 Coding standards

**TypeScript**
- `strict: true`, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. No `any`;
  `unknown` at boundaries, narrowed immediately.
- **Parse, don't validate**: external input becomes a domain type through a schema at the edge, once.
  Nothing downstream re-checks or re-parses.
- **State machines as discriminated unions**, with exhaustive switches checked by a `never` assertion.
  The donor journey and the bag lifecycle are exactly this shape; an added state should break the
  build in every place that must handle it.
- **Expected failures are return values, not exceptions** (`Result`-style). Exceptions are for bugs.
  "Tag already assigned" is not exceptional. It is Tuesday.
- No floating promises; every async call awaited or explicitly handled.
- Units and identifiers are branded types, never bare `string`/`number`. A `BagId` must not be
  assignable to a `DemandId`.

**Python** (vision service, and the bot if it is written in Python)
- Type hints everywhere, strict type checking in CI, a linter and formatter enforced.
- Schema models at every boundary, mirroring the TypeScript schemas.
- No bare `except`.

**Both**
- Functions that read the clock, the network, or randomness take them as parameters. This is what
  makes interval, expiry and wave-timing logic testable without freezing time globally.
- **Comment the why, never the what.** The last-unit conditional UPDATE and the replay-safe
  transitions (§5) are the two places where a future maintainer will "simplify" a correctness
  guarantee. Those need a comment saying what breaks.
- Domain code uses the clinical vocabulary in this document. A reviewer should be able to read
  `donorIsEligible` without a glossary.

### 11.5 Database rules

- **Migrations only.** No auto-create, no schema push against anything but a scratch database.
- **One owner per table** (§2.1), asserted in a comment on the table and, where the database supports
  it, by grants. The bot's role should not have write permission on `blood_bags` at all. A convention
  the database enforces beats a convention people remember.
- Every table has `created_at` / `updated_at`; every state-carrying table has an append-only history
  somewhere (`tag_assignments`, `event_log`, `audit_log`).
- **Constraints in the database, not only in code**: uniqueness, check constraints, foreign keys. The
  unique constraint on a request's decision is what actually prevents a request being decided twice.
  Application logic is the second line, not the first.
- No destructive migration without a reversible plan and a backup verified by restoring it.

### 11.6 Testing

| Layer | What is tested | Speed |
|---|---|---|
| **Domain** | Compatibility matrix in full; eligibility across boundary ages, weights and inter-donation intervals; every state-machine transition and every illegal one; expiry arithmetic across month ends | Milliseconds, no I/O |
| **Concurrency** | The last-unit race, two staff deciding one request, a replayed callback, a double-scanned tag: the bugs that only appear under load and are trivial to test deliberately | Fast, real Postgres |
| **Contract** | Both sides of §7 against the shared schema, run in both codebases | Fast |
| **Adapter** | Chat flows against a fake platform; the vision endpoint against recorded observations; email against a capture server | Fast |
| **Flow** | Every path in §8, including the ways out: especially the stand-down on a cancelled demand | Slower, still in CI |
| **Regression** | Standard clinical wording (§2.7), contrast pairs, control dimensions, service-worker behaviour, PWA install and real-device offline behaviour | Fast |

The rule worth stating plainly: **a bug that reached production gets a test before it gets a fix.**

### 11.7 CI gates

Nothing merges without: typecheck, lint, format check, unit and integration tests, module boundary
check, migration-applies-cleanly check, dependency vulnerability scan, and a build. Add secret
scanning on every push. These gates exist so that "we will tidy it later" is not representable.

### 11.8 Change management

- **Decision records** for choices that are expensive to reverse, the channel port, tag/bag
  separation, vision never writing the register, one decision per request, each deserves a short
  record of *why*, so a future maintainer argues with the reasoning rather than deleting it.
- Conventional commits; pull requests small enough to read.
- The shared contract (§7) is **semantically versioned**, and a breaking change requires both sides
  updated in the same release.
- This document is the specification: **a behaviour change updates it in the same pull request.** A
  spec that drifts from the code is worse than no spec, because people trust it.

### 11.9 Observability

- Structured logs with a correlation id spanning request → decision → demand → wave → confirmation, so
  one unit of blood can be followed end to end.
- **No personal or health data in logs.** Donor ids, not names; request ids, not patient names. This
  is a compliance control as much as a hygiene one (§12).
- Alert on the things that fail silently: a camera that stopped reporting, a wave that did not fire,
  an email provider rejecting, a demand closed without its stand-down messages sent, reconciliation
  tasks or quarantined bags ageing past threshold.
- Health checks that verify the database and the chat platform, not just that the process is alive.

### 11.10 Accessibility and language

- **WCAG 2.2 AA** as the target for all web surfaces: keyboard reachable, visible focus, contrast
  verified by test, no colour-only signals, which the volunteer dashboard's pressure indicator must
  respect (§6).
- Every user-facing string in a resource file from day one, in both the web app and the bot.
  **Malayalam is a requirement deferred, not declined** (§13), and retrofitting externalisation is far
  more expensive than doing it once.
- Chat copy is written for a donor on a cheap phone reading a second language: short sentences, one
  idea per message, no clinical jargon.

---

## 12. Legal and regulatory compliance

**This section is an engineering checklist, not legal advice.** It identifies which regimes plausibly
apply and what each implies for the build, so a qualified advisor can be asked precise questions
instead of "is this okay?". Every item marked **⚖︎** needs sign-off from counsel or the hospital's
compliance officer before a pilot with real patients or real donors. Statutory detail changes; verify
each citation against the current text rather than trusting this table.

### 12.1 What applies

| Regime | Why it reaches this app | What it implies |
|---|---|---|
| **Drugs and Cosmetics Act 1940 & Rules 1945** (Schedule F, blood centre provisions) | Blood centres are licensed establishments; their records, storage and issue are regulated | The bag register, issue records, donor records and their retention are **regulated records**, not merely app data. Storage conditions, labelling and traceability all carry prescribed requirements ⚖︎ |
| **National blood transfusion council donor selection guidelines** | Define who may donate | Age 18–65, minimum weight, donation interval (90 days male / 120 female), deferral criteria: the app's rules. **All must be configuration, not constants**: guidelines are revised, and a code deploy is the wrong way to adopt a new interval |
| **Voluntary non-remunerated donation** | Paid and professional donation is prohibited | **The bot must never offer money, vouchers, or material reward.** Thanks, recognition and a donation record are fine. This constrains any future "incentives" idea absolutely ⚖︎ |
| **Digital Personal Data Protection Act 2023** | Donor and patient data are personal data; health data is sensitive in practice | Consent, notice, purpose limitation, minimisation, accuracy, retention limits, breach notification, grievance redressal, and data-principal rights. See §12.2. Confirm the current commencement and rule-phase deadlines ⚖︎ |
| **Information Technology Act 2000 & SPDI Rules 2011** | Health information is sensitive personal data; reasonable security practices are required | A documented security policy, and liability for negligent handling. Confirm what survives DPDP's commencement ⚖︎ |
| **Clinical establishment regulation** (the central Act where adopted; Kerala's own Act) | The hospital is a registered clinical establishment | Record-keeping and standards obligations the app's records must satisfy ⚖︎ |
| **Medical council professional conduct regulations** | Doctors' records and identity | Medical record retention; the provisional registration number the app stores is a regulated identifier |
| **Bio-Medical Waste Management Rules 2016** | A discarded blood bag is biomedical waste | The **Discard** outcomes in §4 have a physical disposal process behind them. The app should record the disposal route, not pretend a status change is the end of the bag ⚖︎ |
| **TRAI TCCCPR 2018** | Only if SMS or voice is ever added | DLT registration, consent scrubbing, header and template registration. Chat platforms are governed by their own policies instead |
| **Chat platform business policy** | Contractual rather than statutory, but enforced by suspension | Opt-in evidence, approved templates, prohibited content categories. Health-adjacent messaging deserves a policy read before build ⚖︎ |
| **ABDM Health Data Management Policy** | Only if the hospital joins ABDM or issues ABHA numbers | Would add consent-artefact and data-residency requirements. Worth knowing before patient identity is designed ⚖︎ |

### 12.2 DPDP obligations, mapped to features

Most of what the Act asks for is already in this design. What follows names it, so nothing is lost in
translation between the specification and the compliance conversation.

| Obligation | Where it lives | What is still missing |
|---|---|---|
| **Notice and consent** in clear language | §5 step 10: consent recorded with the wording version and a snapshot of the values agreed to | The wording itself needs legal review ⚖︎ |
| **Withdrawal as easy as giving** | §5 donor self-service: snooze, opt out, delete, each one or two taps in the chat | - |
| **Purpose limitation** | Donor data matches donors to demand, and does nothing else. No marketing, no sale, no secondary use | State it explicitly in the notice |
| **Data minimisation** | Donors give what matching needs | **Location is the item to challenge.** Locality-level precision is justified by wave ordering (§5); write that justification down rather than assuming it |
| **Accuracy** | The review-and-confirm summary and the fix-several flow exist precisely so records are correct and correctable | - |
| **Storage limitation** | §12.3 retention schedule | Must be **implemented as scheduled deletion jobs**, not a policy document |
| **Security safeguards** | Hashed tokens and OTPs, role separation, audit, no personal data in logs (§11.9), encryption in transit | Encryption at rest, key management, and a documented access-review cadence |
| **Breach notification** | - | Needs detection, a runbook, timelines, and notification templates ⚖︎ |
| **Grievance redressal** | - | A named contact reachable from the app, the bot and the public board, with a response commitment. This is a hard requirement, and it is a UI element |
| **Rights: access, correction, erasure** | Correction exists; erasure exists with the de-identification carve-out (§5) | An **access/export** path, a donor asking "what do you hold on me?", and an equivalent process for patients |
| **Children's data** | Donors are 18+ by eligibility | **Patients are frequently minors**: the age unit in days and months exists for neonates. Whose consent covers a paediatric patient's record, and how it is evidenced ⚖︎ |

### 12.3 Retention: decide it once, implement it as code

Nothing in this system should be retained "until someone deletes it". Each class of data gets a
period, an owner, and a job that enforces it.

| Data | Basis | Notes |
|---|---|---|
| Blood centre regulated records: bags, issue, donation | The statutory period for blood centre records ⚖︎ | The longest retention in the system, and the reason erasure is de-identification rather than deletion (§5) |
| Patient records, blood requests, samples | The clinical record retention period applicable to the hospital ⚖︎ | The snapshots on a request are part of the record |
| Audit log | At least as long as the records it describes | Immutable, append-only, not editable from any UI |
| Donor profile | While consent stands, plus a defined tail after opt-out | A deletion request short-circuits this |
| Donor journey rows and event log | Short: months, not years, once aggregated | These grow without bound if nothing prunes them |
| Camera frames | Days (§4) | Clinical-area imagery; the shortest retention here |
| OTPs, invite tokens, sessions | Minutes to days | Deleted on use or expiry, not merely marked used |

### 12.4 Data residency and hosting ⚖︎

The deployment shape in §10 puts the database and the app on hosted platforms whose regions must be
chosen deliberately. **Health data crossing a border is a decision, not a default**, and the hosting
choice is the moment it is made, before there is data to migrate. Confirm the current cross-border
transfer position under DPDP, and whether the hospital's own policies or any ABDM participation impose
Indian residency independently. Choose the region, write down why, and prefer providers with an Indian
region for every component that holds donor or patient data.

### 12.5 Compliance features that must be built

These are product work, not paperwork:

1. **A grievance contact**, reachable from the web app, the bot and the public board.
2. **A privacy notice** in the same languages as the interface, versioned, with the version recorded
   against each consent.
3. **Data subject request handling**, access, export, correction, erasure, with a route for patients
   as well as donors, and an audited record of each request and its outcome.
4. **Retention jobs**, per §12.3, with a dry-run mode and a report of what they removed.
5. **Breach detection and a runbook**, with notification templates and timelines.
6. **An access review**: who holds which role, reviewed on a schedule, evidenced.
7. **A record of processing**. What is collected, why, on what basis, who sees it, how long it is
   kept. Generate it from the schema and keep it current, rather than writing it once into a document
   nobody opens.

### 12.6 The disclaimer stays, and it means something

The medical disclaimer in §10 is not boilerplate to be trimmed once the app looks finished. Two claims
in this design depend on it being true and being honoured:

- **The donor health questionnaire is a convenience gate, never a fitness determination.** Fitness to
  donate is decided by the medical officer at the blood centre. Nothing in the bot's wording may imply
  otherwise (§5).
- **The camera's counts are observations, never the basis for issuing blood** (§2.12, §4).

Neither claim survives carelessness. Both need re-checking whenever copy changes, which is why the
standard-wording test (§2.7) is a compliance control and not a curiosity.

### 12.7 Licensing ⚖︎

**Apache License 2.0.**

A noncommercial licence is the wrong instrument here, and actively dangerous: "noncommercial"
has no settled definition, and a private or self-financing hospital that charges patients is
arguably a commercial user. A licence that plausibly forbids the system's own intended
deployment is worse than no licence at all. The question surfaces during the hospital's legal
review, at the worst possible moment.

Apache-2.0 is chosen for four reasons that matter to this specific system:

| Reason | Why it applies here |
|---|---|
| **Institutions can actually adopt it** | Hospital and university legal offices approve Apache-2.0 routinely. It is the licence least likely to stall a deployment |
| **Explicit patent grant** | Health software sits close to patented device and diagnostic territory. A bare permissive licence (MIT, BSD) grants copyright but is silent on patents; Apache-2.0 grants both, and terminates the grant for anyone who sues over patents |
| **Other blood centres can deploy and adapt it** | The point of building this is that a second hospital can run it. Permissive licensing removes the obligation to reason about copyleft before installing software |
| **Clear attribution and change notices** | The `NOTICE` mechanism and the requirement to state modifications suit software whose provenance may later be asked about in a clinical audit |

**The alternative, if the goal changes.** Choose **AGPL-3.0** instead if the priority becomes
preventing a vendor from taking this, closing it, and selling it back to hospitals as a hosted
service. AGPL's network clause forces a hosted fork to publish its source. The cost is real:
some institutions and most vendors decline AGPL software outright, so it trades adoption for
protection. Pick one deliberately; do not drift between them.

**What no licence does.** Every licence here disclaims warranty, and none of them transfers or
limits clinical responsibility. The medical disclaimer (§12.6), institutional validation, and
the regulatory obligations in §12.1 are unaffected by the licence choice and must not be
treated as covered by it. Confirm the final choice with the hospital or university, which may
have its own policy on how software developed in its name is released ⚖︎.

---

## 13. Scope: what the first release does not include

Deliberate exclusions. Each is deferred rather than rejected, and each is listed so it is not
half-built by accident.

**Deferred to a later release**

- **Malayalam, and any second language.** Strings are externalised from day one (§11.10) and donors
  carry a language column, so this is a translation file rather than a code change, but v1 ships in
  English.
- **A reminder to a confirmed donor** before the slot or needed-by time. Confirmation and stand-down
  are in v1; the nudge in between is not.
- **Donor-initiated cancellation after confirming.** The unit release and waitlist promotion exist for
  the centre-side path; letting a donor withdraw themselves and trigger the same promotion is v2.
- **Multi-hospital operation.** Requests carry a centre identifier from day one so the column is not a
  retrofit, but v1 runs one blood centre, and the volunteer dashboard assumes one.
- **Native mobile apps.** The web app installs as a PWA; there is no app-store build.
- **SMS or voice as a channel.** The chat platform is the only outbound path, which is what keeps the
  system clear of telecom commercial-communication regulation (§12.1).
- **Automated vision writing to the register.** Vision reconciles and raises tasks; it never writes
  (§2.12). Promoting it further is a decision to be taken with evidence, not a roadmap item.
- **ABDM / ABHA integration.** Worth knowing about before patient identity is designed (§12.1), not
  worth building yet.

**Not planned at all**

- **An offline write queue.** Clinical data is network-only by design (§2.8), and this is a principle
  rather than a gap.
- **Donor incentives of any material kind.** Prohibited, not deferred (§12.1).
- **Self-registration for staff accounts.** Provisioning is the control (§2.2).

---

## 14. Risks worth naming now

Each of these is a way this system plausibly fails. Naming them here is cheaper than discovering them
during a pilot.

| Risk | Where | What to do about it |
|---|---|---|
| **The camera cannot tell blood groups apart** | §4 | The single most likely reason that feature fails. Solve it physically, one region per group, or a printed marker, not with a better model. Decide this before ordering hardware, because it dictates the shelving |
| **A vision count becomes trusted too early** | §4, §2.12 | Shadow mode, confidence thresholds, and a hard rule that vision never writes the register. Agree the promotion criteria in advance, in writing |
| **A reused tag silently inherits the wrong bag's expiry** | §4 | The three collision cases must not share a button, and re-registering is a new bag record, never an edit of the old one. Expiry derives from the new collection date; a return never recalculates it |
| **Case 3 gets a "resolve anyway" button** | §4 | A tag presented as new whose bag the register believes is on the shelf can put the wrong unit into a patient. It must block until someone physically finds that bag. Resist the pressure to make this dismissible: it will come, from busy staff, and the answer is no |
| **A returned unit is restocked without a cold-chain decision** | §4 | Default to Quarantine when the out-of-storage time is unknown; take the threshold from the hospital's SOP, not from the code |
| **A nudged camera reports confident nonsense** | §4 | Reference-frame drift detection, calibration versioning on every observation, and a visible "needs recalibration" state that stops the counts being trusted |
| **A confirmed donor travels to a hospital that no longer needs them** | §5, §8 | The stand-down message on a cancelled or expired demand is the highest-consequence message in the system and the easiest to forget, because it fires on the path nobody demonstrates. Test it first, not last |
| **A flow is built with an entrance and no exit** | §8 | Quarantine, the case-3 discrepancy, the waitlist, the abandoned draft and the unactioned update request each need an ending. Check every new flow against §8's rule: named endings including the failure ones, and whoever was left waiting is told |
| **The reset OTP becomes an account-enumeration oracle or a brute-force target** | §3 | Identical responses for known and unknown addresses; short expiry; single use; hashed at rest; throttled per account and per IP; sessions revoked on success |
| **The update-request queue becomes a privilege-escalation path** | §3 | Email is kept out of the queue entirely and confirmed from the new address instead (ADR 0012); nobody decides their own request; every decision is audited with the administrator who made it |
| **Reverse geocoding is wrong at locality level** | §5 | Always confirm, never silently accept. Make every level correctable afterwards |
| **Free-text localities fragment the donor pool** | §5 | Match against a seeded hierarchy and store the reference id. Unmatched text goes to a review queue, never straight into the pool |
| **Signup is ten questions long** | §5 | Every question costs completion, and the summary adds a screen before the finish line. Instrument drop-off per step, and be ready to defer weight and the durable screening to first-request rather than signup if the numbers say so |
| **Chat templates must be approved before they can be sent** | §2.11 | On a template-gated platform, donor-facing copy has to be final weeks earlier than otherwise. Draft and submit templates while the rest is still being built |
| **A webhook-delivered channel needs a public endpoint** | §10 | The bot stops being a process with no attack surface. Signature verification, replay protection and rate limiting become load-bearing |
| **A public demand board is a public data surface** | §5, §6 | It is the one page an outsider can read. Verify it exposes only group, hospital, town, units and needed-by: and that no field on it can ever be traced back to a patient |
| **Volunteer admins are outsiders with a login** | §2.2, §6 | Their role must grant aggregates and nothing else. Test it as the wrong role, checking the response body, not just the redirect |
| **Clinical thresholds are hard-coded** | §12.1 | Donation intervals, minimum weight, age bounds, shelf lives and the stock floor are all configuration. Guidelines are revised, and a code deploy is the wrong way to adopt a new one |

---

## 15. Appendix: input field reference

Every screen that accepts input, and every field on it. The sections above explain *why*;
this appendix says *what*.

### Type vocabulary

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
the client (§2.5).

---

### Module 1: Doctor app

#### Sign in

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Email | `email` | ● | - | Lowercased, trimmed |
| Password | `password` | ● | - | Not revealed on error; same message for wrong user and wrong password |
| Return path | hidden | ○ | From URL | Same-origin relative paths only; anything else discarded |

#### Set password (from invite link)

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Invite token | hidden | ● | From URL | Single-use, hashed at rest, expires 24–48 h |
| Email | display | - | From token, read-only | Shown so the user knows which account |
| New password | `password` | ● | - | Min 12 chars |
| Confirm password | `password` | ● | - | Must match |

Same form serves **Set new password** at the end of a reset, with a reset token instead.

#### Forgot password

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Email | `email` | ● | - | Response identical whether or not the account exists |

#### Enter OTP

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| OTP | `text` numeric | ● | - | Exactly 6 digits, ~10 min expiry, single use, throttled per account and IP |

#### Change password (signed in)

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Current password | `password` | ● | - | - |
| New password | `password` | ● | - | Min 12, must differ from current |
| Confirm password | `password` | ● | - | Must match |

#### Profile: seal

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Seal image | `file` | ● | Current seal shown | PNG only, ≤1 MB, re-encoded server-side |

#### Profile: request account update

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Field to change | `select` | ● | - | Email · Display name · Provisional registration |
| Current value | display | - | From account, read-only | - |
| Proposed value | `email` / `text` | ● | - | Type follows the chosen field; must differ from current; uniqueness checked on submit |
| Reason | `textarea` | ● | - | Shown to the approving admin |

One pending request per field per user.

#### Patient: create / edit

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

#### Admission: create

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| IP number | `text` | ● | - | Primary identity of the admission; unique; immutable after create |
| Patient | `search-select` | ● | Prefilled when started from a patient | Must be an existing patient |
| Ward number | `text` | ● | - | - |
| Admitted at | `datetime` | ● | Now | Not future |
| Discharged at | `datetime` | ○ | - | Discharge action only; must be ≥ admitted at |

#### Blood request: draft form

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Admission (IP no.) | `search-select` | ● | From `?ipNo=` when present | Locked once the draft exists |
| Patient name / age / group / ward | display | - | From the admission | Read-only; snapshotted at submit |
| Indication for transfusion | `textarea` | ● | - | Standard clinical wording, pinned by test (§2.7) |
| Date required | `date` | ● | Today | Not past |
| Requested blood group | `select` | ● | Patient's group | Overridable; 8 groups |
| Product | `select` | ● | `Whole Blood` | Whole Blood · Packed Red Blood Cells (PRBC) · Platelet Concentrate (RDP / SDP) · Fresh Frozen Plasma (FFP) · Cryoprecipitate. Standard component names (§2.7); confirm the list against the centre's own component catalogue |
| Units | `int` | ● | `1` | ≥ 1 |
| Doctor name / registration / seal | display | - | Server-derived from session | Never accepted from the client |

**Review screen** takes no input beyond a single Submit action.

#### Blood request: cancel (after submit)

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Reason | `textarea` | ● | - | - |
| Confirm | `checkbox` | ● | - | Warns if bags are reserved or a donor demand is open, and how many donors will be stood down |

#### Blood sample: associate

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Sample identifier | `text` | ● | - | Globally unique |
| Collected at | `datetime` | ● | Now | Not future |
| Collected by | display | - | Server-derived from session | - |

#### Dashboard filters

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Status | `select` | ○ | `All` | All · Draft · Submitted · Cancelled |
| Search | `text` | ○ | - | Request ID, patient name, or IP number |

#### Admin: create account

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Email | `email` | ● | - | Unique; becomes the username and the fixed account identity |
| Full name | `text` | ● | - | - |
| Role | `select` | ● | `doctor` | doctor · admin · blood_centre · volunteer_admin |
| Provisional registration | `text` | ▣ | - | Required for doctor and admin; unique |
| District scope | `typeahead` | ▣ | - | volunteer_admin only; empty = all districts |

No password field. The account is activated by invite link.

#### Admin: account actions

| Screen | Field | Type | Req | Rules |
|---|---|---|---|---|
| Change role | New role | `select` | ● | Cannot change own role; last active admin protected |
| Activate / deactivate | Confirm | `checkbox` | ● | Cannot deactivate self or the last active admin |
| Re-send invite | Confirm | `checkbox` | ● | Invalidates the previous link |
| Update request | Decision | `radio` | ● | Approve · Reject |
| Update request | Note | `textarea` | ▣ | Required on reject |

---

### Module 2: Blood centre dashboard

#### Bag intake (scan an unassigned tag)

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Tag ID | `scan` | ● | From reader | Must be `unassigned`; an assigned tag diverts to the collision screen |
| Unit / donation number | `text` | ● | - | Unique |
| Blood group | `select` | ● | - | 8 groups |
| Product | `select` | ● | `Whole Blood` | 5 products |
| Collected at | `date` | ● | Today | Not future |
| Expires at | `date` | ● | **Derived**: collected at + shelf life for the product | Overridable: the printed label wins; must be ≥ collected at; a mismatch against the derived value is flagged, not blocked |
| Source | `text` | ○ | - | Camp, transfer, in-house |

#### Bag edit / discard

| Screen | Field | Type | Req | Rules |
|---|---|---|---|---|
| Edit | Group, product, collected at, expires at, source | as above | - | Status is not editable here; changes audited |
| Discard | Reason | `select` | ● | Expired · Damaged · Contaminated · Cold-chain breach · Lost · Other |
| Discard | Note | `textarea` | ▣ | Required when reason is Other or Lost |
| Discard | Disposal route | `select` | ● | Biomedical waste stream the bag went to (§12.1) |

#### Inventory filters

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Blood group | `multi-select` | ○ | All | - |
| Product | `multi-select` | ○ | All | - |
| Status | `multi-select` | ○ | `available` | - |
| Expiring within | `select` | ○ | - | 3 · 7 · 14 days |
| Search | `text` | ○ | - | Tag ID or unit number |

#### Bag return (collision case 1)

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Bag details | display | - | From the register | Group, product, expiry, issued-to request and time |
| Time outside controlled storage | `select` | ● | - | Bands, plus **Unknown** |
| Cold chain documented | `radio` | ● | - | Yes · No · Unknown |
| Outcome | `radio` | ● | **`Quarantine`** when time or cold chain is Unknown | Restock · Quarantine · Discard |
| Note | `textarea` | ▣ | - | Required for Quarantine and Discard |

Expiry is never recalculated on return.

#### Quarantine resolution

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Bag and quarantine reason | display | - | From the register | Includes days held |
| Outcome | `radio` | ● | - | Return to available · Discard |
| Note | `textarea` | ● | - | - |
| Resolved by | display | - | Server-derived from session | - |

#### Tag release / re-register (collision case 2)

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Assigned bag | display | - | From the register | Release offered only when this bag is in a terminal state |
| Release reason | `select` | ● | - | Bag issued · Transfused · Discarded · Expired · Tag damaged |
| Note | `textarea` | ○ | - | - |
| Retire this tag | `checkbox` | ○ | Off | Retired tags can never be assigned again |

Re-registering then runs the full **Bag intake** form as a new bag.

#### Tag discrepancy resolution (collision case 3)

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Conflicting bag | display | - | From the register | Tag, unit number, group, expiry, status, location |
| What you found | `radio` | ● | - | Conflicting bag is on the shelf (duplicate/cloned tag) · Conflicting bag is missing · This was a mis-scan |
| Note | `textarea` | ● | - | - |
| Resolved by | display | - | Server-derived from session | - |

Each finding drives a fixed action: retire the tag · mark the bag lost · dismiss.

#### Request decision

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Request summary | display | - | From the request | Group, product, units, needed by; stock on hand for the group |
| Units to issue | `int` | ● | `min(units requested, available)` | 0 … units requested |
| Bags | `multi-select` | ● | **Auto-selected oldest expiry first** | Overridable; only `available` bags of the group; count must equal units to issue |
| Decision | `radio` | ● | **Derived** from units to issue: 0 → Declined, partial → Partial, full → Approved | Overridable to Declined |
| Note | `textarea` | ▣ | - | Required for Partial and Declined |
| Raise donor demand for the shortfall | `checkbox` | ○ | **On** when there is a shortfall and product is whole blood or packed red blood cells; otherwise off and disabled | Never available for platelet, plasma, cryoprecipitate |

#### Stock-floor recruitment

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Groups below floor | `multi-select` | ● | All short groups ticked | Shows current vs floor and the shortfall per group |
| Confirm | `checkbox` | ● | - | Skips any group that already has an open floor demand |

#### Demand: cancel

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Reason | `textarea` | ● | - | - |
| Confirm | `checkbox` | ● | - | States how many confirmed donors will be stood down |

#### Roster: mark a donor

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Donor | display | - | From the roster | Name and verified phone |
| Outcome | `radio` | ● | - | Donated · No-show · Cancelled |
| Donated at | `date` | ▣ | Today | Shown and required only for Donated; not future |
| Bag identifier | `scan` | ○ | - | Shown for Donated; links the donor to the unit collected |
| Note | `textarea` | ○ | - | - |

#### Roster: record a walk-in

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Donor name | `text` | ● | - | Someone who never confirmed in the bot |
| Phone | `tel` | ● | - | - |
| Blood group | `select` | ● | Demand's group | - |
| Donated at | `date` | ● | Today | Not future |
| Bag identifier | `scan` | ○ | - | - |

#### Centre settings

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Hospital name | `text` | ● | Current | Snapshotted onto every new demand |
| Hospital address | `textarea` | ● | Current | Shown to donors |
| District | `typeahead` | ● | Current | From location reference |
| City | `typeahead` | ● | Current | Filtered by district |
| Minimum units per group | `int` | ● | `25` | ≥ 0 |
| Shelf life per product | `int` days ×5 | ● | Current | One per product; drives the derived expiry at intake |
| Return time limit | `int` minutes | ● | Current | From the hospital's SOP; drives the Quarantine default |

#### Camera: device registration

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Device name | `text` | ● | - | - |
| Storage unit | `text` | ● | - | Which fridge or room |
| Device token | display | - | **Generated** | Shown once at creation; revocable, never re-displayed |

#### Camera: region calibration

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

#### Reconciliation task

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Region, expected, observed, confidence, frame, recent scans | display | - | From the observation | - |
| Action | `radio` | ● | - | Correct the register · Dismiss the observation |
| Note | `textarea` | ● | - | - |

---

### Module 3: Donor bot

Chat steps rather than screens. Every step is resumable; nothing is committed until step 10.

#### Onboarding

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

#### Step 10: fix answers

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Jump to a field | `buttons` numbered | ○ | - | Or reply with the row number; re-asks that one question and returns to the summary |
| Fields to fix | `toggle-list` | ○ | Nothing ticked | Tick any number, submit once; the bot walks only those in summary order and returns to the summary once |
| Each re-ask | original type | ● | Current value | Same control as at signup. Changing district resets city, town and locality |

Where `toggle-list` is unavailable on a channel, the same list is numbered and `3, 5, 7`
is accepted as a reply.

#### Per-request screening

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| 6 temporary questions | `buttons` yes/no | ● | - | Fever, medication, recent tattoo, feeling well, last meal, pregnancy (asked only where applicable). A disqualifying answer removes the donor from **this request only** |

#### Request card

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Response | `buttons` | ● | - | Accept · Not this time. Replays are no-ops |

#### Profile and preferences

| Screen | Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|---|
| Edit profile | Same summary + toggle-list as step 10 | - | - | Current values | Saving re-records the acknowledgement |
| Snooze | Duration | `buttons` | ● | - | 1 · 3 · 6 months, or a chosen date. Confirms the date it lifts |
| Opt out | Confirm | `buttons` | ● | - | Reversible; says how to come back |
| Delete my data | Confirm | `buttons` | ● | - | Two-tap. States before deleting that donation records are de-identified, not removed |

#### Demand board

| Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|
| Blood group | `buttons` | ○ | Donor's own group, or All | - |
| District | `buttons` | ○ | Donor's district, or All | - |

---

### Module 4: Volunteer dashboard

| Screen | Field | Type | Req | Prefill | Rules |
|---|---|---|---|---|---|
| Group overview | District scope | `select` | ○ | The volunteer's own district | Only districts in their scope; blank = all |
| Group overview | Blood group tile | navigation | - | - | Tapping a tile opens the demands behind it |
| Demand detail | Copy share message | action | - | Generated from live numbers | Read-only; no free text, so nothing unreviewed is published |

No writable fields. The dashboard reads demand and progress only.

---

### Device and machine inputs

Not screens, but they are input surfaces and validated the same way.

#### Vision observation (camera → centre)

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

#### Tag reader (reader → centre)

| Field | Type | Req | Rules |
|---|---|---|---|
| Reader token | header | ● | Standalone readers only; a reader on a signed-in workstation uses the session |
| Action | `select` | ● | Lookup · Stock · Discard |
| Tag ID | `text` | ● | - |
| Payload | object | ▣ | Per action; Discard requires a reason |
