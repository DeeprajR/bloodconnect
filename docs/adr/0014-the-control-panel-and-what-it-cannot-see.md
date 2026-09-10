# ADR 0014: The control panel, and what it cannot see

Date: 2026-09-10 · Status: accepted

Phase 10: one screen an operator can open at 3am and know, without asking
anyone, whether the system is working and which part is not.

§11.9 named what to alert on and §14 said the correlation id spans request,
decision, demand, wave, confirmation. Neither had a surface. This is that
surface, and most of its design is a consequence of one constraint.

---

## 1. The panel cannot read half of what it reports on

`app_web` holds no grant on the `bot` schema at all. Not a narrow grant: none.
That is §5.1 working rather than a gap, because the bot's half holds donor names
and phone numbers, and a panel that could read them would be a second copy of
the donor register sitting behind an admin login.

But four of §11.9's alerts live entirely on that side: the outbox backlog, the
messages the platform refused, waves whose turn passed without firing, and jobs
that gave up. Half the board was unreachable.

The alternative shapes were both worse. Granting the panel a narrow read into
`bot` would have put a second door into the schema whose whole point is that it
has one. Moving the alerts into the web release would have meant duplicating the
bot's own queries against tables it owns.

**So the bot publishes.** `hospital.process_health` holds one row per process,
rewritten at the end of every ticker pass, carrying counts, ages and a version
string. It crosses the same boundary the recruitment counters already cross on
`donor_demand`. The `Alert` type has no field that could hold a name, and the
panel discards the `sample` ids on anything the bot publishes, because the ids
available on that side are donor ids.

That makes a third shared table, so the contract goes to 1.3.0 (§11.8).

## 2. A heartbeat, and why the timestamp is the whole point

`process_health` is rewritten rather than appended, because it answers "what is
true now" and the history that matters is already in the audit and event logs.

The column that does the work is `observed_at`. A process that stops does not
write "I have stopped": it stops writing. A status column alone cannot tell "the
bot says everything is fine" from "the bot has not said anything since Tuesday",
and the second is precisely what §11.9 means by a silent failure. Anything older
than five minutes is rendered as silence, and the row's contents are treated as
meaningless rather than reassuring.

## 3. Health is doing the job, not reaching the port

Every probe does the dependency's actual work, and building them that way found
a bug that reading the code would not have.

The storage tile was written on `get`, reading a key that does not exist. It was
green with MinIO stopped. `get` swallows every error by design, because a
missing seal should render a placeholder rather than a stack trace, and that
makes it useless as a health check: a deleted bucket and an absent key are
indistinguishable through it. The tile now uses `HeadBucket`, and both ports
grew an explicit `verify` that exists for this and nothing else.

The same reasoning gives SMTP a real handshake rather than a TCP connect. A port
scan stays green through a rejected login, which is the failure that actually
happens when credentials expire.

An in-memory adapter reports **degraded**, not ok. A green tile over a stand-in
implies a mail server was reached, and on a real deployment that difference is
the entire outage.

P10 asked for this to be proven by stopping the container rather than by
inspection, and it is: the test stops Mailpit and MinIO for real and restarts
them afterwards. Postgres is the exception. Stopping the database the suite runs
against would take the suite with it, so its failure comes from a pool pointed
at a closed port, which is the same driver raising the same error through the
same code path.

## 4. Next cannot tell you what it answered

§11.9 asks for latency and error rate per route and per status class. The
obvious home for that is the proxy, and the proxy cannot do it: it runs before
the render, returns `NextResponse.next()`, and never learns what the page
eventually answered with.

Timing the proxy's own work and calling it the request's latency would have
produced a number that looks like a measurement and is not one. So the metrics
are taken in three places where the status is actually known: a completed render
records a 200, a render that throws is recorded as a 500 by the framework's own
`onRequestError` hook, and route handlers record their real status through a
wrapper.

That hook is bundled for the Edge runtime as well as Node, which broke every
page in the admin app the first time it imported the database layer: Argon2's
native build cannot resolve there. It now sits behind a runtime check with the
database work in a separate module, and `recordSample` takes a connection and a
clock rather than the full use-case context, because recording a served request
has no actor, nothing to authorise and nothing to hash.

Rows are per request rather than pre-aggregated, because §11.9 asks for p50 and
p95 and a counter cannot produce a percentile. `route` holds the pattern and
never the path, so no record identifier lands in the table. The window is pruned
at 48 hours: a rolling window answers "is it broken now", and anything longer
wants a time-series store this deployment does not have.

## 5. The trace goes as far as the contract does

§14 says one query should follow a unit of blood end to end, and the honest
version of that claim has a limit.

The bot's internal event log is not readable from this application and never
will be. What is readable is the chain as the shared tables carry it: the
request, the decision, the bags tied to it, the demand raised from the
shortfall, the counters the bot writes back, and the roster rows donors created
by saying yes. Those are the milestones. Rendered against a real record it reads
request raised, centre decided, demand raised, bot picked it up, patient
identified, with the audit trail interleaved.

The screen states that limit on every successful trace, not only when something
is missing, because an operator has to know what it cannot see before concluding
that nothing happened.

Two smaller decisions. It accepts whichever identifier the operator is holding,
including the pre-ADR-0010 `BR-YYYY-NNNNNN` format, because an incident starts
from a log line or a printed slip and the older half of the archive still has
the old ids. And every trace is audited by record id: it reaches a request, a
request identifies a patient, so opening one is a clinical read somebody has to
be answerable for. A query that matched nothing writes no audit row, because
nothing was read and a log padded with failed lookups is one nobody reads.

## 6. Two public endpoints, deliberately different

`/api/health` is shallow, unauthenticated, and answers with one word and a
status code. It exists for a load balancer, which asks only whether traffic
should keep coming.

Keeping it separate from the panel is the point. A public endpoint that
enumerated dependencies would tell an anonymous caller which object store this
deployment uses, which mail provider, and which of them is currently broken.

## 7. A defect the suite found on the way past

The uniqueness test on the donor-facing deep-link id failed during the final
verify: one collision in a thousand. That was not flakiness. Six characters from
a 32-character alphabet is about a billion values, giving a birthday collision
around one in two thousand across a thousand ids, and `bot_public_id` carries no
unique index. A collision hands two demands the same deep link and sends a donor
who taps it to the wrong request.

The id is now eight characters, which is about a trillion values: the same
collision across ten thousand ids falls to roughly one in twenty million. Ids
already issued are stored on their rows and keep working.

**The residual risk is recorded rather than fixed here.** There is still no
uniqueness constraint behind that column, so the guarantee is probabilistic. A
constraint would need a retry path in the import, since the id is derived
deterministically from the request and a refused write would otherwise retry
into the same conflict forever. That belongs in the bot's own phase, not in a
sweep of the operations screen.

## 8. Deferred, as P10 says

Alert *delivery*. The board makes the state visible; routing it to a person
needs somewhere to send it and somebody on call, and a demo has neither.
Long-horizon metric storage is out for the same kind of reason.

## 9. Still open

The centre's request queue ages a request awaiting a bystander but nothing
closes one that never gets collected (ADR 0011 §5). That remains the last ending
with a screen and no button. The deep-link uniqueness constraint of §7 above
joins it.
