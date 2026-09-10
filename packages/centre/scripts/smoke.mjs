/**
 * P6's writes, run as `app_web` against the real database.
 *
 * The test suite connects as `migrator`, which holds every privilege, so a
 * green suite says nothing about whether the column-level grants in migrations
 * 0010, 0013 and 0014 actually permit the code that has to run under them. That
 * gap has already bitten once: `decide()` passed every test and then hit
 * `permission denied for table centre_decisions` the first time it ran as the
 * application, because the grant is append-only and the code updated a row.
 *
 * So this walks the collision cases, the return, the quarantine, the discard and
 * the counter roster as the role the web app really uses, and cleans up after
 * itself as `migrator`.
 *
 * Synthetic records only. Nothing here touches a real patient, donor or member
 * of staff, and the seeded users it borrows carry `.invalid` addresses.
 */
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

import { CONFIG_DEFAULTS } from '@blood-connect/config';
import { idGenerator, newId } from '@blood-connect/ids';
import { argon2Hasher, nodeTokens } from '@blood-connect/platform';
import { APP_TIMEZONE, dayOf } from '@blood-connect/domain';
import {
  discardBag,
  listOpenDiscrepancies,
  listQuarantine,
  markRosterOutcome,
  raiseTagDiscrepancy,
  recordWalkIn,
  registerBag,
  releaseTag,
  resolveQuarantine,
  resolveTag,
  resolveTagDiscrepancy,
  returnBag,
} from '@blood-connect/centre';

const appUrl = process.env.DATABASE_URL;
const migratorUrl = process.env.MIGRATION_DATABASE_URL;

if (!appUrl || !migratorUrl) {
  console.error('DATABASE_URL and MIGRATION_DATABASE_URL must both be set.');
  process.exit(1);
}
if (!/app_web/.test(appUrl)) {
  // The whole point is the reduced role. Running this as the migrator would
  // pass while proving nothing.
  console.error('DATABASE_URL must connect as app_web. That is what this checks.');
  process.exit(1);
}

const app = postgres(appUrl, { max: 4, onnotice: () => undefined });
const admin = postgres(migratorUrl, { max: 2, onnotice: () => undefined });
const db = drizzle(app);

const clock = {
  now: () => new Date(),
  today: () => dayOf(new Date(), APP_TIMEZONE),
};

const tag = (suffix) => `SMOKE-${suffix}-${randomBytes(4).toString('hex').toUpperCase()}`;
const unit = (suffix) => `SMOKE-U-${suffix}-${randomBytes(4).toString('hex').toUpperCase()}`;

let failures = 0;
const created = { bags: [], tags: [], demands: [] };

/** Not a failure: the database already holds what this section wanted to make. */
class SkipCounter extends Error {}

const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  BAD  ${label}${detail ? `: ${detail}` : ''}`);
  }
};

/** Runs a use case and reports a thrown error as the failure it is. */
const attempt = async (label, run) => {
  try {
    const result = await run();
    if (result && result.ok === false) {
      check(label, false, result.error.message);
      return undefined;
    }
    check(label, true);
    return result?.value ?? result;
  } catch (error) {
    // A grant refusal arrives here, wrapped by the driver.
    check(label, false, String(error?.message ?? error).split('\n')[0]);
    return undefined;
  }
};

async function main() {
  const [operator] = await admin`
    SELECT id FROM hospital.users
     WHERE role = 'blood_centre' AND status = 'active' LIMIT 1`;
  if (!operator) {
    console.error('No seeded blood_centre user. Run pnpm db:seed first.');
    process.exit(1);
  }

  const [centre] = await admin`SELECT id FROM hospital.centres LIMIT 1`;
  if (!centre) {
    console.error('No centre row. Run pnpm db:seed first.');
    process.exit(1);
  }

  const actor = {
    kind: 'user',
    userId: operator.id,
    role: 'blood_centre',
    districtScopeId: null,
  };

  const ctx = () => ({
    db,
    clock,
    ids: idGenerator,
    ports: { hasher: argon2Hasher, tokens: nodeTokens },
    actor,
    correlationId: newId(),
    config: CONFIG_DEFAULTS,
  });

  /** A bag on a fresh tag, registered through the real use case. */
  const bagOnTag = async (label) => {
    const tagUid = tag(label);
    const result = await registerBag(ctx(), {
      unitNumber: unit(label),
      bloodGroup: 'O+',
      product: 'prbc',
      collectedAt: clock.today(),
      source: 'Smoke test',
      labelExpiry: null,
      tagUid,
    });
    if (!result.ok) throw new Error(`could not register a bag: ${result.error.message}`);
    created.bags.push(result.value.bagId);
    created.tags.push(tagUid);
    return { bagId: result.value.bagId, tagUid };
  };

  /* ------------------------------------------------------- case 1: return */

  console.log('\ncase 1. A unit that went out and came back');
  {
    const { bagId, tagUid } = await bagOnTag('RET');
    // Issued by the migrator: how it leaves is Module 1's decision path, and
    // this run is about what happens when it comes back.
    await admin`UPDATE hospital.blood_bags SET status = 'issued', issued_at = now(),
                       issued_to_request_id = (SELECT id FROM hospital.blood_requests LIMIT 1)
                 WHERE id = ${bagId}`;

    const resolved = await attempt('the tag resolves to a return', () =>
      resolveTag(ctx(), tagUid),
    );
    check('classified as a return', resolved?.resolution?.kind === 'return',
      `got ${resolved?.resolution?.kind}`);

    await attempt('the return is recorded, into quarantine', () =>
      returnBag(ctx(), {
        bagId,
        outOfStorageBand: 'unknown',
        coldChainDocumented: false,
        outcome: 'quarantine',
        note: 'Smoke test',
      }),
    );

    const waiting = await listQuarantine(ctx());
    const row = waiting.find((entry) => entry.bagId === bagId);
    check('it is in the quarantine list', row !== undefined);

    if (row) {
      await attempt('quarantine resolved as a discard, with a route', () =>
        resolveQuarantine(ctx(), row.id, 'discarded', 'Smoke test', 'Incinerator, bag 4'),
      );
    }
  }

  /* -------------------------------------------------------- case 2: reuse */

  console.log('\ncase 2. A tag whose bag is finished');
  {
    const { bagId, tagUid } = await bagOnTag('REU');
    await attempt('the finished unit is discarded with a route', () =>
      discardBag(ctx(), bagId, 'Smoke test', 'Incinerator, bag 4'),
    );

    const resolved = await attempt('the tag resolves', () => resolveTag(ctx(), tagUid));
    check('classified as a reuse', resolved?.resolution?.kind === 'reuse',
      `got ${resolved?.resolution?.kind}`);

    await attempt('the tag is released', () => releaseTag(ctx(), tagUid, 'Smoke test'));

    const after = await attempt('it resolves again', () => resolveTag(ctx(), tagUid));
    check('now free for a new bag', after?.resolution?.kind === 'unassigned',
      `got ${after?.resolution?.kind}`);
  }

  /* ------------------------------------------------------ case 3: blocked */

  console.log('\ncase 3. A tag whose bag is on the shelf');
  {
    const { tagUid } = await bagOnTag('BLK');
    const resolved = await attempt('the tag resolves', () => resolveTag(ctx(), tagUid));
    check('classified as blocked', resolved?.resolution?.kind === 'blocked',
      `got ${resolved?.resolution?.kind}`);

    const raised = await attempt('a discrepancy is raised', () =>
      raiseTagDiscrepancy(ctx(), tagUid, 'Smoke test'),
    );

    const open = await listOpenDiscrepancies(ctx());
    check('it is open and visible', open.some((row) => row.tagUid === tagUid));

    if (raised?.discrepancyId) {
      await attempt('closed as a mis-scan, with a note', () =>
        resolveTagDiscrepancy(ctx(), raised.discrepancyId, 'mis_scan', 'Smoke test'),
      );
      const stillOpen = await listOpenDiscrepancies(ctx());
      check('and it is gone from the open list',
        !stillOpen.some((row) => row.tagUid === tagUid));
    }
  }

  /* ------------------------------------------------------------ the counter */

  console.log('\nthe counter. Roster and walk-in');
  try {
    /**
     * A group with no open floor demand already.
     *
     * `donor_demand_open_floor_idx` allows one open stock-floor demand per
     * group, which is the point of it: "recruit for groups below floor" must
     * not double-raise. A run on a database that already has one is not a
     * failure, so this picks a free group rather than fighting the index.
     */
    const [free] = await admin`
      SELECT g FROM unnest(ARRAY['O-','O+','A-','A+','B-','B+','AB-','AB+']) AS g
       WHERE NOT EXISTS (
         SELECT 1 FROM hospital.donor_demand d
          WHERE d.blood_group = g AND d.trigger = 'stock_floor' AND d.status = 'open'
            AND d.centre_id = ${centre.id})
       LIMIT 1`;
    if (!free) {
      console.log('  --   every group already has an open floor demand; skipped');
      throw new SkipCounter();
    }

    const demandId = newId();
    created.demands.push(demandId);
    await admin`
      INSERT INTO hospital.donor_demand
        (id, centre_id, trigger, blood_group, product, units, date_required,
         hospital_name, hospital_address, district_id, status)
      VALUES (${demandId}, ${centre.id}, 'stock_floor', ${free.g}, 'whole_blood', 2,
              current_date, 'Smoke centre', 'Nowhere', 'SMOKE', 'open')`;

    const confirmationId = newId();
    await admin`
      INSERT INTO hospital.donor_demand_confirmations
        (id, demand_id, donor_id, channel, donor_name, donor_phone, blood_group, status)
      VALUES (${confirmationId}, ${demandId}, ${newId()}, 'telegram',
              'Synthetic Donor', '+919900000000', 'O+', 'confirmed')`;

    // The write the grant in migration 0014 exists for. If that GRANT is
    // missing, this is where it shows up rather than in production.
    await attempt('a donation is marked, with the group the unit typed as', () =>
      markRosterOutcome(ctx(), {
        confirmationId,
        outcome: 'completed',
        bagIdentifier: unit('ROSTER'),
        donatedBloodGroup: 'B+',
      }),
    );

    const [marked] = await admin`
      SELECT status, donated_blood_group, acknowledged_at
        FROM hospital.donor_demand_confirmations WHERE id = ${confirmationId}`;
    check('the typed group was written', marked?.donated_blood_group === 'B+');
    check('and it is left unacknowledged, for the bot',
      marked?.acknowledged_at === null);

    // Not a confirmation row: the centre holds no INSERT there, which is what
    // this run discovered the first time it was tried (migration 0015).
    await attempt('a walk-in is recorded in the centre’s own table', () =>
      recordWalkIn(ctx(), {
        demandId,
        donorName: 'Synthetic Walk In',
        donorPhone: '+919900000001',
        bloodGroup: 'A+',
        bagIdentifier: unit('WALKIN'),
      }),
    );
  } catch (error) {
    if (!(error instanceof SkipCounter)) throw error;
  }

  /* ------------------------------------------- what the grants must refuse */

  console.log('\nwhat app_web must not be able to do');
  {
    const refused = async (label, statement) => {
      try {
        await statement();
        check(label, false, 'it was allowed');
      } catch (error) {
        check(label, /permission denied/i.test(String(error?.message ?? error)),
          String(error?.message ?? error).split('\n')[0]);
      }
    };

    // §14: a return, a discard and a quarantine are statements about a unit of
    // human blood. A correction is a new record, never a rewrite.
    // The refusal that produced migration 0015: the bot creates the roster.
    await refused('insert a confirmation row', () =>
      app`INSERT INTO hospital.donor_demand_confirmations
            (id, demand_id, donor_id, channel, donor_name, donor_phone, blood_group)
          VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'walk_in',
                  'Nobody', '+910000000000', 'O+')`);
    await refused('rewrite a walk-in', () =>
      app`UPDATE hospital.walk_in_donations SET bag_identifier = 'something else'`);

    await refused('edit a discard', () =>
      app`UPDATE hospital.bag_discards SET disposal_route = 'somewhere else'`);
    await refused('delete a return', () => app`DELETE FROM hospital.bag_returns`);
    await refused('delete a quarantine', () => app`DELETE FROM hospital.bag_quarantines`);
    await refused('delete a discrepancy', () => app`DELETE FROM hospital.tag_discrepancies`);
  }

  /* --------------------------------------------------------------- tidy up */

  for (const demandId of created.demands) {
    await admin`DELETE FROM hospital.walk_in_donations WHERE demand_id = ${demandId}`;
    await admin`DELETE FROM hospital.donor_demand_confirmations WHERE demand_id = ${demandId}`;
    await admin`DELETE FROM hospital.donor_demand WHERE id = ${demandId}`;
  }
  if (created.bags.length > 0) {
    await admin`DELETE FROM hospital.tag_discrepancies WHERE conflicting_bag_id = ANY(${created.bags})`;
    await admin`DELETE FROM hospital.bag_discards WHERE bag_id = ANY(${created.bags})`;
    await admin`DELETE FROM hospital.bag_quarantines WHERE bag_id = ANY(${created.bags})`;
    await admin`DELETE FROM hospital.bag_returns WHERE bag_id = ANY(${created.bags})`;
    await admin`DELETE FROM hospital.tag_assignments WHERE bag_id = ANY(${created.bags})`;
    // Status and bag move together, or the assigned check refuses it, as it
    // should: an assigned tag with no bag on it is the state case 3 exists for.
    await admin`UPDATE hospital.rfid_tags SET current_bag_id = NULL, status = 'unassigned'
                 WHERE current_bag_id = ANY(${created.bags})`;
    await admin`DELETE FROM hospital.blood_bags WHERE id = ANY(${created.bags})`;
  }
  if (created.tags.length > 0) {
    await admin`DELETE FROM hospital.rfid_tags WHERE tag_uid = ANY(${created.tags})`;
  }
  await admin`DELETE FROM hospital.audit_log WHERE metadata->>'source' = 'smoke'`;

  console.log(
    failures === 0
      ? '\nP6 RUNS AS app_web, ALL OK'
      : `\n${failures} problem(s). The grants and the code disagree.`,
  );
}

try {
  await main();
} finally {
  await app.end({ timeout: 5 });
  await admin.end({ timeout: 5 });
}

process.exit(failures === 0 ? 0 : 1);
