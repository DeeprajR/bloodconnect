# QA test protocol

Every flow the system claims to support, and the ways it is most likely to break. 105
checks, written against the build at commit `fd1fad3`.

Work top to bottom the first time. The modules build on each other, and the end-to-end run
in §7 needs records the earlier sections create. Tick a box when a check passes; when one
fails, leave the box empty and write the outcome on the line beneath it.

Section references in square brackets point at [the specification](blood-connect-spec.md).

---

## Before you start

Run these one at a time. Windows PowerShell does not accept `&&` as a statement separator.

```
pnpm up
pnpm db:migrate
pnpm db:migrate:bot
pnpm db:seed
pnpm dev
```

In a second terminal, for the donor bot. Without a Telegram token it runs on the in-memory
channel, so the whole conversation can be driven from the terminal:

```
pnpm bot
```

### Where things live

Four of these open in a browser:

| Service | Open at |
|---|---|
| Staff app | <http://localhost:3000> |
| Administration | <http://localhost:3001> |
| Mailpit inbox | <http://localhost:8025> |
| MinIO console | <http://localhost:9001>, `minioadmin` / `minioadmin` |

**Postgres is not one of them.** It speaks its own protocol on port 5433, so a browser
pointed at it will simply fail to connect. Reach it with a database client, or with `psql`
inside the container:

```
docker exec -it blood-connect-postgres-1 psql -U migrator -d blood_connect
```

For a graphical client, fill the fields in rather than pasting a URL. Every client accepts
these, and the two URL formats are not interchangeable:

| Field | Value |
|---|---|
| Host | `localhost` |
| Port | `5433` |
| Database | `blood_connect` |
| User | one of the three below |
| Password | the same word as the user |

**A JDBC client needs the `jdbc:` form.** DBeaver, DataGrip and anything else built on the
Java driver reject a `postgres://` URI with *invalid JDBC URL*, because that is libpq's
format, used by `psql` and by this project's own Node driver. Both are correct, for
different clients:

```
psql and Node:   postgres://migrator:migrator@localhost:5433/blood_connect
JDBC clients:    jdbc:postgresql://localhost:5433/blood_connect
```

The JDBC form carries no credentials. Put the user and password in the client's own fields.

Which role you connect as decides what you are allowed to see, which is the whole point of
having three:

| User | Password | Sees |
|---|---|---|
| `migrator` | `migrator` | Everything. Use this to inspect |
| `app_web` | `app_web` | What the two web apps can reach. Nothing in the `bot` schema |
| `app_bot` | `app_bot` | The bot's own schema, and only the agreed columns of the shared demand table |

Connecting as `app_web` and trying to read a donor is itself a useful check, and the port
number is deliberate: a natively installed PostgreSQL usually holds 5432, and a connection
that silently reaches the wrong server is a bad hour
([ADR 0001](adr/0001-phase-0-decisions.md)).

These passwords are development passwords, committed to the repository in
`db/docker/init.sql`. That is safe only because nothing real runs against this stack;
production creates these roles outside the release.

### Who to sign in as

Every seeded account uses the password `BloodConnect!Demo2026`. All four addresses end
`@blood-connect.invalid`, a domain reserved so it can never resolve.

| Account | Does |
|---|---|
| `doctor@` | Raises requests. Staff app |
| `centre@` | Inventory, decisions, roster. Staff app |
| `volunteer@` | Dashboard only, scoped to one district |
| `admin@` | Accounts and the control panel. Administration app |

### Starting clean

To wipe everything and rebuild, including the database roles:

```
docker compose down -v
pnpm up
pnpm db:migrate
pnpm db:migrate:bot
pnpm db:seed
```

Re-running the seed on its own resets the seeded passwords and destroys nothing else.

### The automated layers, before the manual one

| Command | Covers |
|---|---|
| `pnpm verify` | Typecheck, lint, boundaries, access and audit gates, 603 tests |
| `pnpm smoke:centre` | The centre's writes as `app_web`, and what that role must be refused |
| `pnpm smoke:bot` | The same for `app_bot` |
| `pnpm smoke:signin` | Sign-in against a running server, the way a browser with no JavaScript would |

The test suite connects as `migrator`, so it proves nothing about the grants. The two smoke
scripts are the only thing that does.

---

## 0. Accounts, sign-in and access

The layer everything else sits on. Three independent checks guard every route, so a failure
here is worth more than a failure anywhere else. [§2.3, §3, §13]

- [ ] **M0-1** As the administrator on `:3001`, add a doctor. Open Mailpit.
  - Expect: an invite email arrives, and the link sets a password and lands them **on the
    doctor dashboard**, not back on a sign-in form.
  - Why: an admin never sees or chooses the password. An invite that ends on a sign-in page
    is a flow with a dead end in it.
- [ ] **M0-2** Open the same invite link a second time.
  - Expect: refused, with a message that says to ask for a new one.
- [ ] **M0-3** Look at the doctors list with an invite that was never activated.
  - Expect: the row shows how many days it has been waiting.
- [ ] **M0-4** Start a password reset. Read the six-digit code from Mailpit. Enter it wrong
      five times.
  - Expect: after the fifth, told to **start the reset again**, with both forms on one page
    so step one is already in front of you. The code lasts ten minutes.
- [ ] **M0-5** Sign in with a wrong password five times inside fifteen minutes.
  - Expect: locked out, with the wait stated in minutes.
- [ ] **M0-6** Try three sign-ins: an address with no account, a real address with a wrong
      password, and a deactivated account.
  - Expect: **all three give the identical message.**
  - Why: three different messages would let anyone check whether a given doctor has an
    account here.
- [ ] **M0-7** From a doctor profile, change the email address. Check Mailpit.
  - Expect: a confirmation link to the **new** address and a warning to the **old** one.
    Opening the link changes the address.
  - Why: the link proves the person holds the new inbox. An admin approving it would only
    prove that an admin agreed.
- [ ] **M0-8** Start an email change, then cancel it from the profile page.
  - Expect: the account keeps its current address and the pending notice disappears.
- [ ] **M0-9** As a doctor, ask to change your name from the profile page. Approve it as the
      administrator at `/updates`.
  - Expect: the name changes without the administrator retyping it, and the queue row goes.
- [ ] **M0-10** As the administrator, raise an update request for your own account, then look
      at `/updates`.
  - Expect: no approve or reject buttons, and a line saying another administrator has to
    decide it.
- [ ] **M0-11** Reject a request with a note.
  - Expect: the doctor sees the note on their profile page, not just a refusal.
- [ ] **M0-12** Withdraw a pending request, then ask for the same field again.
  - Expect: allowed. Two pending requests for one field are not.
- [ ] **M0-13** Sign in as a doctor on `:3000`, then open `localhost:3001` in the same browser.
  - Expect: 403. **View source and confirm the body carries no data at all**, rather than
    only that you were redirected.
- [ ] **M0-14** Deactivate an account that is signed in elsewhere. Reload that other window.
  - Expect: signed out immediately, not at the next expiry.

---

## 1. Doctor app, the request slip

Four fields and an identifier. Speed is the whole design goal, so time yourself as well as
checking the result. [§3, [ADR 0010](adr/0010-the-doctor-app-becomes-a-request-slip.md)]

- [ ] **M1-1** Sign in as the doctor and raise a request.
  - Expect: four inputs visible, blood group, product, units, urgency. Everything else sits
    behind a closed disclosure.
- [ ] **M1-2** Read the identifier you get back.
  - Expect: the format `DDMMYY-NNNNN`. Raise a second one and the sequence advances by one.
- [ ] **M1-3** Raise one request at each urgency and check the needed-by date.
  - Expect: emergency, very urgent and urgent are all **today**. Routine is **seven days out**.
- [ ] **M1-4** Count the taps from the dashboard to holding an identifier.
  - Record the number. This is the figure to defend when anyone proposes adding a field.
- [ ] **M1-5** Go back to the dashboard immediately after submitting.
  - Expect: the new request is listed, with its urgency and how long it has been waiting.
  - Why: this was a real defect. The dashboard joined through the patient table, so a request
    with no patient yet was invisible.
- [ ] **M1-6** Cancel a request from the dashboard.
  - Expect: it reads as cancelled, and the centre sees the cancellation on its queue.
- [ ] **M1-7** Open the collapsed section and fill in a few optional details.
  - Expect: they save, and the request still submits without any of them.
- [ ] **M1-8** Turn the network off in devtools and reload.
  - Expect: the offline page, carrying **no clinical data**. Not a cached copy of the last
    page you viewed.

---

## 2. Blood centre

The largest surface, and the one where a wrong answer has physical consequences. Work the
collision cases carefully. They are the ones that never appear in a demo. [§4]

- [ ] **M2-1** Open `/centre` and read the stock chart.
  - Expect: eight bars, each carrying a **colour and a number and a label**. Cover the colour
    with a hand and the state is still readable.
- [ ] **M2-2** Register a blood bag through the intake form.
  - Expect: expiry derived from the product's shelf life, not typed.
- [ ] **M2-3** Open the blood requests tab and type in the identifier from M1-1. The date
      should be prefilled.
  - Expect: five digits finds it. A four-digit sequence is **refused, not guessed at**.
- [ ] **M2-4** Attach a patient to that request.
  - Expect: four required fields, the rest behind a disclosure. Age or date of birth, either
    one, not both.
- [ ] **M2-5** Decide three different requests: approve, part-approve, decline.
  - Expect: each records who decided. A partial records units issued against units asked for.
- [ ] **M2-6** Try to issue against a request with no patient attached at urgency `urgent`.
      Then try the same at `emergency`.
  - Expect: urgent is **refused**. Emergency is allowed and the decision **records that the
    patient was unidentified**.
  - Why: a unit of blood has to be traceable to a named person. The exception exists because
    in an emergency the alternative is worse.
- [ ] **M2-7** Return an issued bag three times over: restock, quarantine, discard.
  - Expect: each needs a person and a reason. A discard also records where the unit
    physically went.
- [ ] **M2-8** Look at a quarantine older than seven days.
  - Expect: shown as overdue on the quarantine screen and on the control panel.
- [ ] **M2-9** Present a tag the register says is already issued.
  - Expect: refused, and told to process the return first rather than being allowed to
    re-register it.
- [ ] **M2-10** Release a tag from its bag.
  - Expect: needs a reason, and the assignment history keeps the old row rather than
    overwriting it.
- [ ] **M2-11** Raise a tag discrepancy, then resolve it under each of the three findings.
  - Expect: duplicate tag, bag missing, mis-scan. Each needs the resolver's identity and a
    note. **Mis-scan changes nothing**, which is the whole of that outcome.
- [ ] **M2-12** Record a walk-in donation against an open demand. Run the bot ticker.
  - Expect: the outstanding count drops, and the bot **stops recruiting for those units**.
- [ ] **M2-13** Drop a group below its floor, then try to raise a second stock-floor demand
      for the same group.
  - Expect: the first is raised automatically. The second is refused by the database, not by
    a screen.
- [ ] **M2-14** Mark one roster entry as donated and another as a no-show.
  - Expect: both recorded, and the donated one carries a bag identifier.
- [ ] **M2-15** Change the stock floor on the settings screen.
  - Expect: the chart bands move to match, and the change is audited.

---

## 3. Donor bot

Read the wording as carefully as the behaviour. How a deferral is phrased is a requirement
here, not a detail. [§5]

- [ ] **M3-1** Complete a registration from the first message to the acknowledgement.
  - Expect: the location chain walks district then town, and the last question is answered
    before any acknowledgement is asked for.
- [ ] **M3-2** Register once at exactly 18, once at 17, once at 65, once at 66.
  - Expect: 18 and 65 accepted. 17 and 66 deferred, and the deferral says **when they could
    return** where that is knowable.
- [ ] **M3-3** Register at exactly 45 kg, then at 44.
  - Expect: 45 accepted, 44 deferred.
- [ ] **M3-4** Register a male donor who gave 89 days ago, and a female donor who gave 119
      days ago.
  - Expect: both told not today, with the date they become eligible. Ninety days and a
    hundred and twenty.
- [ ] **M3-5** Read every deferral message you have triggered.
  - Expect: **never the word rejected**, never a medical explanation, always what happens next.
  - Why: a deferral is not a verdict on a person, and a donor who reads one as rejection does
    not come back.
- [ ] **M3-6** At the acknowledgement, decline it.
  - Expect: registered and **kept dormant**, not deleted. Sending `resume` brings them back
    with nothing to retype.
- [ ] **M3-7** Use the fix-several-answers flow on the summary.
  - Expect: the list stays open while you toggle several, then submits once.
- [ ] **M3-8** Send each command: `needs`, `pause`, `resume`, `stop`, `delete`, `help`.
  - Expect: each does what it says, and help lists them all.
- [ ] **M3-9** Delete a donor who has given blood before.
  - Expect: the reply **says what was removed and what was kept**. The unit number and
    donation date survive; the name and phone number do not.
- [ ] **M3-10** Raise a demand and let the ticker run through two waves.
  - Expect: twenty donors per wave, thirty minutes apart, and the second wave does not
    re-message the first twenty.
- [ ] **M3-11** Ask a donor whose blood group has never been confirmed by staff to see the
      board.
  - Expect: they can read it, and are told plainly why they cannot answer yet, with a way
    forward.
- [ ] **M3-12** Fill a request from another source while a donor is still holding a live card
      for it.
  - Expect: told it is covered **at the moment it fills**, not hours later when the demand
    closes.
  - Why: in between, tapping the card would have put them on a waiting list they never asked
    to join.
- [ ] **M3-13** Abandon a registration halfway and leave it.
  - Expect: exactly one reminder, ever. Not two.
- [ ] **M3-14** Open the deep link from a demand card.
  - Expect: it reaches the right request. The identifier is eight characters and excludes
    O, 0, I and 1.

---

## 4. Volunteer dashboard and public board

Counts and hospitals. The test that matters most here is the one that checks what is absent.
[§6, §9.4]

- [ ] **M4-1** Sign in as the volunteer and read the eight tiles.
  - Expect: each carries a group, a count, a state in words, and a line of context.
- [ ] **M4-2** Take a group below its floor with nothing outstanding against it.
  - Expect: the tile is **not green**. It reads as needing donors.
  - Why: a green tile over an empty shelf tells a volunteer the opposite of the truth.
- [ ] **M4-3** Tap a tile.
  - Expect: the open demands behind it, soonest needed first, with the town.
- [ ] **M4-4** Copy the share message.
  - Expect: generated from the live numbers, with **no box to edit it**. No patient, no
    doctor, no donor named, and the town is not printed twice.
- [ ] **M4-5** As the district-scoped volunteer, edit the URL to try to widen the view.
  - Expect: the scope does not move. It comes from the account, not the query string.
- [ ] **M4-6** Read the six-week trend strip.
  - Expect: every bar carries its two numbers as well as its length.
- [ ] **M4-7** Open `localhost:3000/board` signed out, with the public board flag off, then on.
  - Expect: off, it says it is not published. It does **not** show a plausible-looking sample.
- [ ] **M4-8** With the board published, read a row and view source.
  - Expect: five fields only, group, hospital, town, units needed, needed by. No count of who
    was messaged or who confirmed.

---

## 5. Control panel

The screen you open when something is wrong, so test it by making things wrong.
Administrator only, at `:3001/panel`. [§11.9, §14]

- [ ] **M5-1** Open `/panel` with everything running.
  - Expect: four dependency tiles, all green, each with a latency and a last-checked time.
- [ ] **M5-2** Run `docker stop blood-connect-mailpit-1` and reload.
  - Expect: the email tile red with the **actual connection error** and what it blocks.
    **The other three stay green.**
  - Why: a probe that reported everything down whenever anything was would be no more useful
    than one that reported everything up.
- [ ] **M5-3** Do the same with `blood-connect-minio-1`.
  - Expect: storage red, the rest green. Start both containers again afterwards.
- [ ] **M5-4** Stop the bot and wait five minutes.
  - Expect: its heartbeat reads **Silent**, and the page says nothing on it about the bot is
    current.
- [ ] **M5-5** Follow a request three ways: by its printed number, by a demand identifier, and
      by a correlation id from a log line.
  - Expect: all three reach the same chain. Raised, decided, demand, bot picked it up.
- [ ] **M5-6** Run a trace, then look at the audit log. Then run a trace that matches nothing
      and look again.
  - Expect: the successful one wrote a row naming the record. The miss wrote **nothing**.
- [ ] **M5-7** View source on `/panel` and search for a seeded donor's name and phone number.
      Do the same on a trace result.
  - Expect: **neither appears.**
  - Why: the panel reads across three modules. It is the code most likely to acquire a name
    in a select list one afternoon.
- [ ] **M5-8** Use both apps for a few minutes, then reload the panel.
  - Expect: traffic rows split by surface and by route, with p50 and p95 rather than an
    average.
- [ ] **M5-9** Open `/panel/deployment`.
  - Expect: every configuration key, marked as either the compiled default or overridden in
    this database, and a migration count that matches reality.
- [ ] **M5-10** Open `localhost:3000/api/health` signed out.
  - Expect: one word and a status code. **It names no dependency.**
  - Why: a public endpoint that enumerated dependencies would tell an anonymous caller which
    of them is currently broken.
- [ ] **M5-11** Open `/panel` with a doctor's session.
  - Expect: 403, and nothing in the body.

---

## 6. End to end, one unit of blood

The only run that exercises both deployables together. Do it in one sitting, in order, and
keep the identifier from step 2 to hand.

- [ ] **E-1** Start everything: containers, both apps, and the bot.
  - Expect: four dependency tiles green on the panel before you begin.
- [ ] **E-2** As the doctor, raise an `urgent` request for a group you know is short.
  - Expect: you are holding an identifier. Write it down.
- [ ] **E-3** As the centre, find that identifier at the counter.
  - Expect: found on the first try, with the date prefilled.
- [ ] **E-4** Attach a patient, then part-approve it so a shortfall remains.
  - Expect: the shortfall raises a donor demand automatically.
- [ ] **E-5** Watch the bot ticker pick the demand up.
  - Expect: it gets a public identifier and a first wave goes out.
- [ ] **E-6** As a donor in the bot, accept the request.
  - Expect: the confirmation appears on the centre's roster.
- [ ] **E-7** As the volunteer, look at that blood group's tile.
  - Expect: the count and the state have moved to match.
- [ ] **E-8** As the centre, mark the donor as having donated, and register the collected bag.
  - Expect: stock rises, and the demand's collected count rises.
- [ ] **E-9** Issue the remaining units against the original request.
  - Expect: the request closes, and the demand closes with it.
- [ ] **E-10** Check any donor still holding a card for that demand.
  - Expect: told it is covered, and the card no longer offers to accept.
- [ ] **E-11** On the panel, follow the identifier from step 2.
  - Expect: the whole chain in one screen, in order, with the audit trail interleaved.
- [ ] **E-12** Read the panel's board.
  - Expect: nothing waiting on anybody, or only what you left waiting deliberately.

---

## 7. Stress, concurrency and abuse

Two browser windows side by side are the only tool most of these need. Where a check says
simultaneously, get both windows ready and submit within a second of each other.

- [ ] **S-1** Open the same request in two centre windows. Decide it in both, simultaneously.
  - Expect: one decision lands. The other is **told plainly** that it was already decided.
    Not a crash, and not two decisions.
- [ ] **S-2** Raise requests from two doctor windows at the same instant.
  - Expect: two different sequence numbers, consecutive, with no gap and no duplicate.
- [ ] **S-3** Present the same tag twice in quick succession.
  - Expect: the second is handled as a collision, not as a second bag.
- [ ] **S-4** Run the bot ticker while the centre issues bags against the same demand.
  - Expect: no deadlock, and the counters afterwards add up.
- [ ] **S-5** Kill the bot mid-wave, then restart it.
  - Expect: no donor receives the same message twice.
  - Why: the outbox is written in the same transaction as the thing it announces, and the
    dedupe key makes a redelivery harmless.
- [ ] **S-6** Stop Mailpit. Create five doctors. Start Mailpit. Reload a page.
  - Expect: all five invites arrive, each exactly once, and the panel showed the backlog
    while it was stopped.
- [ ] **S-7** Stop Postgres. Reload both apps and both health endpoints.
  - Expect: a real failure page, not a blank screen. `/api/health` answers 503.
- [ ] **S-8** Open a long form. Sign out in another window. Submit the form.
  - Expect: refused and sent to sign in. Not a stack trace, and nothing half-written.
- [ ] **S-9** Double-click a submit button as fast as you can.
  - Expect: one record, not two.
- [ ] **S-10** Submit a request, press the browser back button, and submit again.
  - Expect: no duplicate request.
- [ ] **S-11** Push all eight groups below their floor.
  - Expect: eight demands, one per group, and no group raises two.
- [ ] **S-12** Create thirty or more open demands, then open the volunteer board and the
      public board.
  - Expect: both render, and **neither scrolls sideways**. Tables scroll inside their own
    container.
- [ ] **S-13** Raise a routine request at 23:59 local time.
  - Expect: the needed-by date counts seven days from the correct day, not from the server's
    timezone.
- [ ] **S-14** Enter a hospital name and a patient name of sixty characters.
  - Expect: nothing clipped, nothing overflowing its column.
- [ ] **S-15** Complete a whole request using the keyboard only.
  - Expect: every control reachable, and every focused control visibly focused.
- [ ] **S-16** Set the browser to 200% zoom and repeat the request flow on a narrow window.
  - Expect: still usable, with targets still big enough for a thumb.
- [ ] **S-17** Sign in as each of the four roles in turn and try to reach every other role's
      landing page.
  - Expect: twelve refusals, each a 403 with an empty body rather than a redirect.
- [ ] **S-18** Leave a request identifier uncollected and watch the centre queue.
  - Expect: it ages visibly as awaiting the bystander.
  - **Known gap.** Nothing yet closes one that is never collected
    ([ADR 0011 §5](adr/0011-the-endings-sweep-and-one-milestone-short.md)). Expect it to sit
    there, and record that it does.

---

## 8. Reader and camera, deferred

Neither is wired in yet. The first two can be done today, before any integration.

- [ ] **H-1** Label your two RFID cards physically, A and B, and record their unique
      identifiers.
  - Why: half of tag testing is knowing which card is which. Both are needed, one for a bag
    and one for a collision. A single card cannot test the case that matters.
- [ ] **H-2** Note the exact card identifier format the RC522 reports.
  - Why: the reader presents as a keyboard, so this determines what arrives in the intake
    field.
- [ ] **H-3** Once wired: assign card A to a bag, then present card B.
  - Expect: unknown tag, offered for registration.
- [ ] **H-4** Present card A again while its bag is issued.
  - Expect: the case-1 refusal from M2-9, now through real hardware.
- [ ] **H-5** Once the camera is wired: run it in shadow mode against a known shelf.
  - Expect: it records what it counted without changing any figure. The register stays
    authoritative.

---

## Recording a defect

Leave the box unticked and write the outcome beneath it. Keep the detail in this shape:

```
Test:        M2-6
Role:        blood_centre
What I did:  Issued 2 units against a request with no patient
             attached, urgency = urgent
Expected:    Refused
Got:         Issued, decision recorded
Severity:    Blocks a release
Trace:       /panel/trace?q=100926-00042
```

The trace line is worth the extra minute. It turns a report into something that can be
followed without reproducing it first.

### Severity, plainly

| Level | Means |
|---|---|
| Blocks a release | A wrong clinical answer, a refusal that did not happen, or data reaching somebody who should not see it |
| Fix before the demo | A flow with no way out, a message that misleads, a screen that cannot be used on a phone |
| Log it | Wording, spacing, anything cosmetic that does not mislead |
