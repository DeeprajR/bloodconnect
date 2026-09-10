/**
 * Two CI gates the specification names by hand, checked mechanically.
 *
 * Both are the kind of rule that holds for exactly as long as somebody
 * remembers it, which on a solo build is not long. §11.7 makes CI the reviewer,
 * so these are build failures rather than review comments.
 *
 *   1. **Every page guards** (§13). The three authorization layers only work if
 *      layer two is actually present on each page. The proxy runs on a matcher
 *      a new route can be added without, and the role-matrix test asserts the
 *      shared decision function rather than any particular page calling it. So a
 *      page with no guard passes every existing test and leaks.
 *
 *   2. **Every mutating use case writes an audit or event row** (§14, §2.9).
 *      "A new use case with no audit write fails CI" is the spec's own wording.
 *
 * Both are file-level rather than function-level, which is coarser than §14's
 * wording and is stated here rather than glossed: a file that writes and audits
 * somewhere passes, even if one function in it does not. It catches the case
 * that actually happens, a whole new use case added without one, and does not
 * pretend to more.
 *
 *   node scripts/check-gates.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

let failures = 0;
const bad = (message) => {
  failures += 1;
  console.error(`  BAD ${message}`);
};

function walk(dir, match) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.next') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full, match));
    else if (match(full)) found.push(full);
  }
  return found;
}

/** Comments are prose, and prose that mentions a guard is not a guard. */
const codeOf = (file) =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/* ========================================================================== */
/* 1. Every page and route handler decides access                             */
/* ========================================================================== */

/**
 * Pages that are public by design.
 *
 * Every entry is a deliberate decision, and adding one should feel like a
 * decision. Which is why they are listed here rather than inferred from the
 * route table. `/` and the sign-in page render for anonymous visitors; the
 * offline and forbidden pages are what somebody is shown *instead of* content.
 */
const PUBLIC_PAGES = new Set([
  'apps/web/src/app/offline/page.tsx',
  'apps/web/src/app/forbidden/page.tsx',
  'apps/admin/src/app/offline/page.tsx',
  'apps/admin/src/app/forbidden/page.tsx',
  // Administration has no landing page; this redirects to a guarded one.
  'apps/admin/src/app/page.tsx',
]);

const GUARDS = ['requireAccess', 'requirePermission', 'currentActor', 'redirect('];

const pages = walk(path.join(root, 'apps'), (file) => {
  const name = path.basename(file);
  return name === 'page.tsx' || name === 'route.ts';
});

console.log(`checking ${String(pages.length)} pages and route handlers…`);

for (const file of pages) {
  const relative = path.relative(root, file).replace(/\\/g, '/');
  if (PUBLIC_PAGES.has(relative)) continue;

  const code = codeOf(file);
  if (!GUARDS.some((guard) => code.includes(guard))) {
    bad(
      `${relative} decides no access. Layer 2 of §13 is per page. Call ` +
        'requireAccess, or add it to PUBLIC_PAGES here with a reason.',
    );
  }
}

/* ========================================================================== */
/* 2. Every mutating use case records what it did                             */
/* ========================================================================== */

const WRITES = ['.insert(', '.update(', '.delete('];
const RECORDS = ['createAuditWriter', 'createEventWriter'];
const OPENS_TRANSACTION = '.transaction(';

/**
 * The discriminator is §3's own rule, not a list of exceptions.
 *
 * **A use case opens the transaction; a repository is handed one.** So a file
 * that opens a transaction *and* writes is a use case, and owes an audit row. A
 * file that only ever receives a `tx`, every repository, and the deliberate
 * seams like `for-centre.ts` and `enqueue` that join somebody else's
 * transaction, is recorded by its caller, which is where the context to write
 * a useful row actually is.
 *
 * This also settles the adapters without naming them: `hash.update()` and an
 * object-storage `delete()` are not database writes, and neither file opens a
 * transaction. An allowlist would have hidden that they were false positives.
 */
const isUseCase = (code) =>
  code.includes(OPENS_TRANSACTION) && WRITES.some((write) => code.includes(write));

/**
 * Mechanisms that open a transaction and write, but are not use cases.
 *
 * Short by design. If this list grows, the rule above has stopped describing
 * the codebase and should be changed rather than exempted around.
 */
const NOT_USE_CASES = new Set([
  // Outboxes. Each row was already audited by the action that queued it, and
  // the drain records delivery on the row itself.
  'packages/platform/src/repositories/email-outbox.ts',
  // Throttling counters. Auditing a rate-limit tick would bury the log in
  // rows nobody will ever read (§14).
  'packages/platform/src/repositories/rate-limits.ts',
]);

const moduleSources = ['platform', 'hospital', 'centre', 'bot'].flatMap((module) => {
  const dir = path.join(root, 'packages', module, 'src');
  return walk(dir, (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));
});

console.log(`checking ${String(moduleSources.length)} module sources…`);

for (const file of moduleSources) {
  const relative = path.relative(root, file).replace(/\\/g, '/');
  if (NOT_USE_CASES.has(relative)) continue;

  const code = codeOf(file);
  if (!isUseCase(code)) continue;

  if (!RECORDS.some((record) => code.includes(record))) {
    bad(
      `${relative} opens a transaction and writes, but records nothing. §2.9 ` +
        'and §14 want an audit or event row for every mutating use case.',
    );
  }
}

/* ========================================================================== */
/* Both checks prove they can fail                                            */
/* ========================================================================== */

const unguarded = 'export default function Page() { return <p>hello</p>; }';
if (GUARDS.some((guard) => unguarded.includes(guard))) {
  bad('the guard check would pass a page that decides nothing');
}

const silentUseCase =
  'return ctx.db.transaction(async (tx) => { await tx.insert(patients).values({ id }); });';
if (!isUseCase(silentUseCase) || RECORDS.some((r) => silentUseCase.includes(r))) {
  bad('the audit check would pass a use case that records nothing');
}

// A repository is handed a transaction and is not a use case, however much it
// writes. That distinction is what the whole check rests on.
const repository = 'export async function touchLastLogin(tx, id) { await tx.update(users); }';
if (isUseCase(repository)) {
  bad('the audit check mistakes a repository for a use case');
}

// And that they do not fail everything, which is the other way to be useless.
const guarded = 'const actor = await requireAccess("/dashboard");';
if (!GUARDS.some((guard) => guarded.includes(guard))) {
  bad('the guard check rejects a page that does decide access');
}

if (failures === 0) {
  console.log('every page decides access, and every mutating use case records what it did.');
}

process.exit(failures === 0 ? 0 : 1);
