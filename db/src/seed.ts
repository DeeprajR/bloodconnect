/**
 * The seed runner.
 *
 * "Seed before UI" is a standing rule of the build plan: every phase starts by
 * extending this, so there is data to build against and the demonstration
 * dataset grows continuously instead of being invented at the end.
 *
 * Two properties it must keep:
 *
 *  - **Idempotent.** Running it twice changes nothing the second time, so it can
 *    be part of a one-command bring-up.
 *  - **Synthetic only.** No real donor, patient or staff record enters this
 *    system at any point, including "just to test" (build plan, prerequisites).
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { sql as raw } from 'drizzle-orm';
import postgres from 'postgres';

import { databaseUrl, redact } from './env.js';
import {
  DATASET_SOURCE,
  DATASET_VERSION,
  readLocationSeed,
} from '../seeds/locations.js';
import { locationAliases, locationDatasetVersions, locationNodes } from './schema/index.js';

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
    `seeded ${nodes.length} location nodes (${localities} localities) and ${aliases.length} aliases\n`,
  );
}

async function main(): Promise<void> {
  // Seeding writes reference data the application role cannot create, so it
  // runs as the migrator like the migrations it follows.
  const url = databaseUrl('migrator');
  process.stdout.write(`seeding ${redact(url)}\n`);

  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await seedLocations(drizzle(client));
    process.stdout.write('seed complete\n');
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`seed failed: ${String(error)}\n`);
  process.exit(1);
});
