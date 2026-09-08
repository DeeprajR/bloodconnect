# ADR 0003 — Administration becomes a separate application

Date: 2026-09-08 · Status: accepted · Supersedes parts of §1, §2, §3 and §9

The specification has one staff web application holding Modules 1, 2 and 4, with `admin` as a
role inside it. This splits administration out into its own deployment and narrows what it does.

---

## 1. Five processes, not four

§1 describes `web`, `worker`, `bot` and `vision`. There is now a fifth: `admin`.

**Why it is defensible.** Administration is the only surface with no clinical function. It cannot
raise a blood request, cannot decide one, and cannot issue a unit. Separating it means an
administrator account compromised reaches no clinical action at all, and a clinical account
reaches no account management — which is a stronger version of the separation §2.2 already draws
between raising a request and deciding it.

**What it costs.** A second deployment, a second build, and one more thing to keep in step. The
shared code is now a package rather than a directory, which is the right shape but was work.

| | Application | Port (dev) | Roles | Cookie |
|---|---|---|---|---|
| A | `web` | 3000 | doctor, blood_centre, volunteer_admin | `bc_session` |
| E | `admin` | 3001 | admin | `bc_admin_session` |

## 2. Sessions carry the application that issued them

`sessions.audience` is `staff` or `admin`, and `resolveActor` will not match across it.

**Why a column and not just a cookie name.** In development both applications are on
`localhost`, and cookies are **not** isolated by port — a staff cookie is visible to the admin
app and vice versa. Relying on the role check alone would work, but it makes the isolation a
consequence of application logic rather than a fact. A session that names its issuer is refused
before any role is consulted.

`decideAccess` enforces the same split a third time: a role that does not belong to the
application is refused whatever the route rule says.

## 3. The platform module moved to `packages/platform`

Two applications now share accounts, sessions, authorization, audit, email and configuration.
§2 puts modules inside `apps/web`, which was right when there was one app; with two, the boundary
rule "apps may not import each other" made the shared module's home wrong.

So `apps/web/src/modules/platform` became `packages/platform`, and it owns the database
connection as well. Both applications import it by name. The boundary check now cruises each
application under its own path mapping, because both use `@/*` for their own source — one shared
mapping silently resolved the admin app's imports into the staff app and reported violations
that were not there.

## 4. What administration can do

**Doctors only.** Create, read, update, deactivate and reactivate — name, provisional
registration number, email address and seal. Creating one sends an invite; there is no password
field, because at that moment no password exists.

`admin` no longer holds `requests:manage`, `patients:manage`, `centre:operate` or
`volunteer:view`. §9's matrix changes accordingly: the admin column is now **no** on every staff
surface.

**Patients per doctor — full records, with a caveat this ADR exists to record.**

The decision is that an administrator sees everything the doctor sees, including diagnosis,
history and the request contents. That is a large disclosure surface for a non-clinical account,
and it is a deliberate choice rather than a drift: §9.4 is careful that the public board cannot
reach a patient column, and Module 4 sees aggregates only.

What follows from it:

- `patients:read_all` is its own permission, held by nobody else.
- Every read under it is audited individually — not a page view, but each record opened.
- **Its lawful basis is an open question for counsel** (§12.2), joining the list in §19.3. This
  is the one item here that a demonstration can ship without and a deployment cannot.

The screens are not built: patients and admissions arrive in phase 2. The doctor page says so
rather than showing an empty table, which would read as "this doctor has no patients".

## 5. The address change is confirmed by the doctor, not approved by an administrator

§3 has an admin queue for account update requests, with one pending request per field. For email
that is replaced by a self-confirmed change:

1. The doctor requests a new address.
2. A single-use link goes to the **new** address, and a warning to the **old** one.
3. Opening the link applies the change.

**Why this is the stronger of the two.** An approval queue proves an administrator agreed. A link
delivered to the proposed address proves the person actually holds it — which is the thing that
matters, because the risk being defended against is an account quietly moving to someone else's
inbox. The warning to the old address means an unauthorised change is visible to the person about
to lose the account, whichever route it took.

**Consequence.** `account_update_requests` is not built. Name and registration number are now
changed by administrator CRUD, so the queue has nothing left to carry. §3's description of it,
and §8's "⚠︎ untouched → ages visibly in the admin queue" ending, no longer apply.

An administrator can still set a doctor's address directly. That path also notifies the old
address, for the same reason.

## 6. Known debt

- **The email drain runs in `after()`**, not in the `worker` process §1 describes. The outbox
  itself is the real mechanism — rows commit with their cause and a failed send retries with
  backoff — and moving the drain into a separate process changes nothing about the transactions.
  But until it moves, a message is only sent when a request happens to trigger a drain.
- **Seal uploads are validated, not re-encoded.** §3 asks for server-side re-encoding, which
  needs a native image library. What is done instead: the PNG signature is checked, the chunk
  structure is walked, the real dimensions are read from IHDR, and any trailing byte after IEND
  is rejected — which is where a polyglot file hides its second payload. The serving route sends
  `nosniff`, an explicit content type and a restrictive CSP. The residual gap is a PNG that is
  also valid as something else *within* its chunk structure.
- **A user with audit history cannot be deleted.** `audit_log.actor_user_id` references `users`
  with no cascade, so deletion is refused. That is correct — an audit log that vanishes with its
  subject is not one — and it means deactivation, not deletion, is how a staff account ends.
  Erasure under §12.2 will need de-identification, as it already does for donors.
