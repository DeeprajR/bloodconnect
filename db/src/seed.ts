/**
 * The seed runner.
 *
 * "Seed before UI" is a standing rule of the build plan: every phase starts by
 * extending this, so there is data to build against and the demonstration
 * dataset grows continuously instead of being invented at the end.
 *
 * Three properties it must keep:
 *
 *  - **Idempotent.** Running it twice changes nothing the second time, so it can
 *    be part of a one-command bring-up.
 *  - **Synthetic only.** No real donor, patient or staff record enters this
 *    system at any point, including "just to test" (build plan, prerequisites).
 *  - **Never against production.** It creates accounts with a published
 *    password. On a real deployment that is not a seed, it is a back door.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { count, eq, sql as raw } from 'drizzle-orm';
import postgres from 'postgres';

import { CONTRACT_VERSION, CONTRACT_VERSION_CONFIG_KEY } from '@blood-connect/contract';
import { newId } from '@blood-connect/ids';

import { databaseUrl, nodeEnv, redact } from './env.js';
import { SEED_PASSWORD, buildAccountSeeds } from '../seeds/accounts.js';
import {
  DATASET_SOURCE,
  DATASET_VERSION,
  readLocationSeed,
} from '../seeds/locations.js';
import { buildStockSeed } from '../seeds/stock.js';
import { buildDonorSeed, type PlaceSeed } from '../seeds/donors.js';
import {
  donorChannels,
  donorConsents,
  donorPhones,
  donors as donorTable,
} from './schema-bot/index.js';
import {
  appConfig,
  bloodBags,
  centreSettings,
  locationAliases,
  locationDatasetVersions,
  locationNodes,
  users,
} from './schema/index.js';

/** This deployment's centre. Multi-tenant needs more rows, not a migration. */
const CENTRE_ID = '01930000-0000-7000-8000-000000000001';

type Database = ReturnType<typeof drizzle>;

async function seedLocations(db: Database): Promise<void> {
  const nodes = await readLocationSeed();

  await db
    .insert(locationDatasetVersions)
    .values({ version: DATASET_VERSION, source: DATASET_SOURCE })
    .onConflictDoUpdate({
      target: locationDatasetVersions.version,
      set: { source: DATASET_SOURCE },
    });

  // Parents before children: the rows arrive in hierarchy order and the
  // self-referencing foreign key is checked per statement.
  for (const node of nodes) {
    await db
      .insert(locationNodes)
      .values({
        id: node.id,
        level: node.level,
        kind: node.kind,
        parentId: node.parentId,
        name: node.name,
        nameNormalised: node.nameNormalised,
        datasetVersion: DATASET_VERSION,
      })
      .onConflictDoUpdate({
        target: locationNodes.id,
        set: {
          level: node.level,
          kind: node.kind,
          parentId: node.parentId,
          name: node.name,
          nameNormalised: node.nameNormalised,
          datasetVersion: DATASET_VERSION,
          updatedAt: raw`now()`,
        },
      });
  }

  const aliases = nodes.flatMap((node) =>
    node.aliases.map((aliasNormalised) => ({ nodeId: node.id, aliasNormalised })),
  );

  if (aliases.length > 0) {
    await db.insert(locationAliases).values(aliases).onConflictDoNothing();
  }

  const localities = nodes.filter((n) => n.level === 'locality').length;
  process.stdout.write(
    `  locations: ${nodes.length} nodes (${localities} localities), ${aliases.length} aliases\n`,
  );
}

async function seedAccounts(db: Database): Promise<void> {
  const accounts = await buildAccountSeeds();

  for (const account of accounts) {
    await db
      .insert(users)
      .values({
        id: account.id,
        email: account.email,
        fullName: account.fullName,
        role: account.role,
        provisionalReg: account.provisionalReg,
        districtScopeId: account.districtScopeId,
        status: account.status,
        passwordHash: account.passwordHash,
      })
      // Re-running resets the seeded password rather than skipping, so a
      // half-finished experiment on a development database cannot leave an
      // account nobody can sign in to.
      .onConflictDoUpdate({
        target: users.email,
        set: {
          fullName: account.fullName,
          role: account.role,
          provisionalReg: account.provisionalReg,
          districtScopeId: account.districtScopeId,
          status: account.status,
          passwordHash: account.passwordHash,
          updatedAt: raw`now()`,
        },
      });
  }

  process.stdout.write(`  accounts: ${accounts.length}, one per role\n`);
  for (const account of accounts) {
    process.stdout.write(`    ${account.role.padEnd(16)} ${account.email}\n`);
  }
  process.stdout.write(`  password:  ${SEED_PASSWORD}\n`);
}

/**
 * Points the centre at its district, now that the hierarchy exists.
 *
 * Migration 0010 creates the settings row without one, because `district_id` is
 * a foreign key into `reference.location_nodes` and the migrations run before
 * this file does. Set here rather than there, so a fresh database migrates
 * cleanly and the demand use case has an address to snapshot.
 */
async function seedCentreSettings(db: Database): Promise<void> {
  await db
    .update(centreSettings)
    .set({ districtId: 'KL_KKD', cityId: 'KKD_T1', updatedAt: raw`now()` })
    .where(eq(centreSettings.id, 1));

  process.stdout.write('  centre:    settings pointed at Kozhikode (KL_KKD)\n');
}

/**
 * Stock on the shelf.
 *
 * Idempotent through the unique unit number: re-running adds nothing, and a
 * bag that has since been reserved or issued keeps whatever happened to it.
 * Deliberately not a fixed set of ids — a seed that resurrected an issued unit
 * would be rewriting the register.
 */
async function seedStock(db: Database): Promise<void> {
  const bags = buildStockSeed();

  await db
    .insert(bloodBags)
    .values(
      bags.map((bag) => ({
        id: bag.id,
        centreId: CENTRE_ID,
        unitNumber: bag.unitNumber,
        bloodGroup: bag.bloodGroup,
        product: bag.product,
        collectedAt: bag.collectedAt,
        expiresAt: bag.expiresAt,
        expirySource: 'derived' as const,
        source: bag.source,
        status: 'available' as const,
      })),
    )
    .onConflictDoNothing();

  const [held] = await db
    .select({ n: count() })
    .from(bloodBags)
    .where(eq(bloodBags.status, 'available'));

  process.stdout.write(
    `  stock:     ${held?.n ?? 0} bags available (synthetic, SYN- prefixed)\n`,
  );
}

/**
 * The synthetic donor pool.
 *
 * Placed across the real seeded hierarchy so the wave ordering of §7.7 is
 * visible on the first demand raised — the nearest locality first, then the
 * town, then the taluk. A pool that all sits in one place shows none of that.
 *
 * Idempotent through the unique `(channel, channel_user_id)` index: re-running
 * adds nobody, and a donor who has since given blood keeps their interval.
 */
async function seedDonors(db: Database): Promise<void> {
  const nodes = await db
    .select({ id: locationNodes.id, level: locationNodes.level, parentId: locationNodes.parentId })
    .from(locationNodes);

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const parentAt = (id: string | null, level: string): string | null => {
    let current = id;
    while (current) {
      const node = byId.get(current);
      if (!node) return null;
      if (node.level === level) return node.id;
      current = node.parentId;
    }
    return null;
  };

  // Prefer localities, so the nearest tier is populated; fall back to towns.
  const leaves = nodes.filter((node) => node.level === 'locality');
  const source = leaves.length > 0 ? leaves : nodes.filter((node) => node.level === 'town');

  const places: PlaceSeed[] = source.map((node) => ({
    districtId: parentAt(node.id, 'district') ?? 'KL_KKD',
    cityId: parentAt(node.id, 'city'),
    townId: parentAt(node.id, 'town'),
    localityId: node.level === 'locality' ? node.id : null,
  }));

  if (places.length === 0) {
    process.stdout.write(
      '  donors:    skipped — no location hierarchy to place them in\n',
    );
    return;
  }

  const pool = buildDonorSeed(places);
  const now = new Date();

  for (const donor of pool) {
    const inserted = await db
      .insert(donorTable)
      .values({
        id: donor.id,
        name: donor.name,
        dob: donor.dob,
        sex: donor.sex,
        bloodGroup: donor.bloodGroup,
        // Verified, because an unverified donor is never selected into a wave
        // (§7.7) and a demo pool nobody can be recruited from shows nothing.
        bloodGroupVerifiedAt: now,
        weightBand: donor.weightBand,
        weightKg: donor.weightKg,
        districtId: donor.districtId,
        cityId: donor.cityId,
        townId: donor.townId,
        localityId: donor.localityId,
        lastDonatedOn: donor.lastDonatedOn,
        nextEligibleOn: donor.nextEligibleOn,
        durableFlagStatus: 'clear',
        consentCurrentAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: donorTable.id });

    if (inserted.length === 0) continue;

    await db
      .insert(donorChannels)
      .values({
        donorId: donor.id,
        channel: 'memory',
        channelUserId: donor.channelUserId,
      })
      .onConflictDoNothing();

    await db
      .insert(donorPhones)
      .values({ donorId: donor.id, e164: donor.phone, verified: true, verifiedAt: now })
      .onConflictDoNothing();

    await db.insert(donorConsents).values({
      id: newId(),
      donorId: donor.id,
      consentedAt: now,
      wordingVersion: '1.0.0',
      valuesSnapshot: { seeded: true, note: 'Synthetic donor, consent recorded by the seed.' },
    });
  }

  const [held] = await db.select({ n: count() }).from(donorTable);
  const [eligible] = await db
    .select({ n: count() })
    .from(donorTable)
    .where(raw`next_eligible_on IS NULL OR next_eligible_on <= current_date`);

  process.stdout.write(
    `  donors:    ${held?.n ?? 0} synthetic, ${eligible?.n ?? 0} eligible today
`,
  );
}

async function seedConfig(db: Database): Promise<void> {
  // Both processes assert their compiled contract version against this at boot
  // and refuse to start on a major mismatch (§6).
  await db
    .insert(appConfig)
    .values({ key: CONTRACT_VERSION_CONFIG_KEY, value: CONTRACT_VERSION })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value: CONTRACT_VERSION, updatedAt: raw`now()` },
    });

  // Every clinical threshold keeps its default until someone changes it on
  // purpose. Writing the defaults as rows here would freeze today's guideline
  // values into the database and hide a later change to them (§12).
  process.stdout.write(`  config:    contract.version = ${CONTRACT_VERSION}\n`);
}

async function main(): Promise<void> {
  if (nodeEnv() === 'production' && process.env['ALLOW_PRODUCTION_SEED'] !== 'yes') {
    process.stderr.write(
      'seed refused: NODE_ENV is production. This creates accounts with a published password.\n',
    );
    process.exit(1);
  }

  // Seeding writes reference data the application role cannot create, so it
  // runs as the migrator like the migrations it follows.
  const url = databaseUrl('migrator');
  process.stdout.write(`seeding ${redact(url)}\n`);

  const client = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    const db = drizzle(client);
    await seedLocations(db);
    await seedAccounts(db);
    await seedCentreSettings(db);
    await seedStock(db);
    await seedDonors(db);
    await seedConfig(db);
    process.stdout.write('seed complete\n');
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`seed failed: ${String(error)}\n`);
  process.exit(1);
});
