# ADR 0002 — Decisions taken while building Phase 1

Date: 2026-09-08 · Status: accepted

Phase 1 is identity and access. The plan's reason for building it early is that retrofitting
three-layer authorization across finished screens costs far more than building it once, so these
are the choices that shape every screen after it.

---

## 1. Deployment is deferred; the app is completed locally first

**Decision.** Supabase is a deploy-time choice, not a development one. Docker Compose stays the
development and CI stack until the system is complete.

**Why.** Everything the architecture depends on — `FOR UPDATE SKIP LOCKED`, partial unique
indexes, column-level grants, three roles — is plain PostgreSQL, and all of it works on Supabase.
Nothing about building against local Postgres forecloses it. What *would* foreclose choices is
adopting Supabase's PostgREST, RLS and Auth layers, because §13's three authorization layers,
§3's use-case transaction boundary and §2.2's admin-provisioned accounts are all written against
an application server that owns the database, not a database that owns the API.

**Consequence.** Two things to get right when deployment happens, recorded now so they are not
rediscovered: the worker's boot-time advisory lock (§1) needs a session-mode connection, because
a transaction pooler hands out a different backend per transaction and a session-scoped advisory
lock silently fails to hold; and `postgres.js` needs `prepare: false` through a transaction
pooler. Neither affects development.

---

## 2. Next 16's `proxy`, not `middleware` — and no matcher

**Decision.** Layer 1 of §13 is `apps/web/src/proxy.ts`. There is no route matcher: every request
reaches it, and `decideAccess` decides.

**Why.** Next 16 deprecates the `middleware` convention in favour of `proxy`, which always runs on
the Node.js runtime. That is what lets layer 1 resolve the session against the database rather
than merely noticing a cookie exists — a `blood_centre` account is stopped before a page renders,
which is what §13 asks for and what an edge-runtime middleware could not do.

Proxy allows no route-segment config, so the matcher had to go. That turned out to be an
improvement: the architecture plan's own warning is about a route added without a matching
pattern, and a proxy with no matcher cannot have that failure. Every unmatched path falls to
`defaultAccess`, which denies.

**Consequence.** The proxy pays a session lookup per request. Static assets are skipped by a
regex before the lookup. If that ever shows up in a profile, the fix is a short-lived signed
claim in the cookie, not removing the layer.

---

## 3. Both refusals exist, and they differ

**Decision.** `decideAccess` returns `unauthenticated` or `forbidden`, never one refusal. An
anonymous visitor is redirected to sign in; a signed-in user on the wrong surface gets a 403 page
that renders **no data at all** — not the path, not the role, not what would have been shown.

**Why.** §14 names the mistake precisely: a test that asserts the redirect rather than the body
passes while a payload rides along underneath. A 403 page with nothing on it is what makes that
test meaningful. And sending a signed-in user to a sign-in form implies a different account might
work, which is untrue and an invitation.

**Verified.** Every 403 body across every wrong-role combination is byte-identical and mentions no
role name, no dashboard content and no email address.

---

## 4. One decision function, three call sites

**Decision.** The proxy, the page guard and (via `actorHas`) the use case all call into
`modules/platform/domain/authorization.ts`. The route table and the permission table are data in
that one file.

**Why.** Three independent layers are only worth having if they cannot disagree about the rule.
What must differ between them is *when* they run — before rendering, at render, and inside the
transaction — not *what they decide*. A job, a script or a future HTTP caller passes through
neither of the first two, which is why the third exists at all.

**Consequence.** A new route needs a rule, or it is unreachable. That is the failure direction
that gets noticed in development.

---

## 5. A decoy hash, because the message alone is not enough

**Decision.** When no account matches, `signIn` verifies the supplied password against a real
Argon2id hash of a value nobody knows, then returns the same error as a wrong password.

**Why.** §15 requires identical responses for a wrong user and a wrong password. An identical
*message* is not sufficient: without the decoy, "no such account" returns in about a millisecond
and "wrong password" takes the ~100ms Argon2id deliberately costs. That difference is the
enumeration oracle the rule exists to prevent, readable over the network.

The same path covers a deactivated account and one never activated, so all four cases cost the
same and say the same thing. A test asserts the four errors are byte-identical.

---

## 6. A successful sign-in clears the account throttle, never the IP throttle

**Decision.** On success, `login_account` counters for that address are deleted; `login_ip`
counters are left standing.

**Why.** Someone who mistypes three times and then succeeds should not spend the rest of the
window one slip from a lockout. But a hospital sits behind shared addresses, and one person
signing in correctly must not reset an attacker's budget from the same address.

**Consequence.** The IP limit is set well above the account limit (20 vs 5 per 15 minutes) so a
busy ward does not throttle itself. Both are configuration (§12).

---

## 7. Argon2id parameters are not named in code

**Decision.** `@node-rs/argon2` is called without an explicit `algorithm`, and a test asserts the
produced hash begins with `$argon2id$`.

**Why.** The library's `Algorithm` enum is an ambient const enum, unreachable under
`verbatimModuleSyntax`. The alternatives were to relax that compiler setting for one call, or to
hardcode the magic number `2`. Asserting the real output is stronger than either: it checks what
the library actually produced rather than what a constant claims.

Memory and time cost *are* named (19 MiB, t=2 — the OWASP floor), and `needsRehash` upgrades a
stored hash on the next successful sign-in, which is the only moment the plaintext exists.

---

## 8. UX4G, with exactly two root token overrides

**Decision.** The interface uses `ux4g-web-components` (npm, per Design.md's delivery order),
`data-theme="light"`, and overrides two custom properties at `:root`:

| Token | From | To | Why |
|---|---|---|---|
| `--ux4g-bg-neutral` | `neutral-50` `#FAFAFA` | `neutral-0` `#FFFFFF` | Asked for: white background, black text. Text stays `--ux4g-text-neutral-primary` (`#171717`), 17.7:1 on white, so no text override is added |
| `--ux4g-control-border-default` | `neutral-200` `#E5E5E5` | `neutral-500` `#737373` | Design.md §9 measures the stock value at **1.21:1** and calls it a release blocker: under WCAG 1.4.11 an input's boundary is a required 3:1 target. The contract states the fix — repoint at a darker step of the same ramp — and this is that. 4.54:1 on white |

Both names were read out of the installed `styles/ux4g.css`, not inferred; the contract forbids
inventing a token name.

**Known debt, worth stating.** `ux4g-web-components/styles/ux4g.css` is **8.0 MB**, because the
fonts are base64-embedded. The spec describes doctors on hospital wifi, mobile-first, at the
bedside (§10). Design.md flags this itself as the highest-impact fix available on the web side.
It has not been mitigated here; the options are a components-only build, or CDN delivery with
separate `woff2` files. It should be resolved before the demonstration.

**Contract drift.** Design.md §0 records `ux4g-web-components` at **2.0.1**; the installed version
is **2.1.0**. The contract asks that the version table be updated on every release, so this is a
known gap in the table rather than in the code.

---

## 9. Deferred to phase 5, deliberately

Invites, OTP reset, account update requests, the admin panel, seals and `email_deliveries` are all
phase 5. The routes that would dead-end without them — `/reset` in particular — exist and say what
they are, because a link to nowhere is exactly the ending §8 exists to prevent.
