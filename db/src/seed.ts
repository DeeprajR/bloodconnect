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
import { sql as raw } from 'drizzle-orm';
import postgres from 'postgres';

import { CONTRACT_VERSION, CONTRACT_VERSION_CONFIG_KEY } from '@blood-connect/contract';

import { databaseUrl, nodeEnv, redact } from './env.js';
import { SEED_PASSWORD, buildAccountSeeds } from '../seeds/accounts.js';
import {
  DATASET_SOURCE,
  DATASET_VERSION,
  readLocationSeed,
} from '../seeds/locations.js';
import {
  appConfig,
  locationAliases,
  locationDatasetVersions,
  locationNodes,
  users,
} from './schema/index.js';

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
