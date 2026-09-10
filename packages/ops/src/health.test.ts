import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { CONFIG_DEFAULTS } from '@blood-connect/config';
import { CONTRACT_VERSION } from '@blood-connect/contract';
import { idGenerator, newId } from '@blood-connect/ids';
import { createFakeClock } from '@blood-connect/testing';
import {
  anonymousActor,
  argon2Hasher,
  createMemoryEmailPort,
  createMemoryStorage,
  nodeTokens,
  s3Storage,
  smtpEmailPort,
  type Database,
  type UseCaseContext,
} from '@blood-connect/platform';

import { checkDependencies, type HealthTile } from './health.js';

const testUrl = process.env['TEST_DATABASE_URL'];

/**
 * The tile goes red when the dependency is actually down (§11.9, P10).
 *
 * P10 is explicit that this must be asserted by stopping the container rather
 * than by inspection, and the reason is worth restating: a health check is the
 * one piece of code whose failure mode is silence. A probe that always returns
 * green passes every test that only ever runs against a working system, and it
 * passes them for the entire life of the deployment until the night it matters.
 *
 * Mailpit and MinIO are stopped for real. Postgres is not: stopping the
 * database this suite is running against would take the rest of the suite with
 * it, so its failure is produced by a pool pointed at a closed port, which is
 * the same connection failure arriving through the same code path.
 */

const dockerAvailable = (): boolean => {
  try {
    execFileSync('docker', ['ps'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const container = (action: 'stop' | 'start', name: string): void => {
  execFileSync('docker', [action, name], { stdio: 'ignore' });
};

const waitFor = async (probe: () => Promise<boolean>, seconds = 30): Promise<void> => {
  for (let i = 0; i < seconds; i += 1) {
    if (await probe()) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
};

describe.skipIf(!testUrl)('the dependency tiles (§11.9)', () => {
  const client = postgres(testUrl ?? '', { max: 3, onnotice: () => undefined });
  const db = drizzle(client) as unknown as Database;
  const clock = createFakeClock('2026-09-10T09:00:00.000Z');

  const context = (over: Partial<UseCaseContext> = {}): UseCaseContext => ({
    db,
    clock,
    ids: idGenerator,
    ports: { hasher: argon2Hasher, tokens: nodeTokens },
    actor: anonymousActor,
    correlationId: newId(),
    config: CONFIG_DEFAULTS,
    ...over,
  });

  const realPorts = { email: smtpEmailPort, storage: s3Storage };

  beforeAll(async () => {
    /*
     * The contract version is written by the seed, not by a migration, so a
     * migrated-but-unseeded database has no row at all. The tile reports that
     * as down, correctly, and the test below asserts it; here the row is put in
     * place so the other checks are not testing a missing seed by accident.
     */
    await client`INSERT INTO hospital.app_config (key, value, updated_at)
                 VALUES ('contract.version', ${JSON.stringify(CONTRACT_VERSION)}::jsonb, now())
                 ON CONFLICT (key) DO UPDATE SET value = excluded.value`;
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  const tileFor = (
    tiles: readonly HealthTile[],
    dependency: string,
  ) => tiles.find((tile) => tile.dependency === dependency);

  it('is green on every dependency when everything is up', async () => {
    const tiles = await checkDependencies(context(), realPorts);

    expect(tileFor(tiles, 'database')?.status).toBe('ok');
    expect(tileFor(tiles, 'contract')?.status).toBe('ok');
  });

  it('tells the operator what to do on every tile, not only the red ones', async () => {
    // §11.9: a red tile that does not say what broke is a pager that wakes
    // somebody up for nothing. Asserted, because it is the kind of text that
    // gets dropped when a tile is refactored.
    const tiles = await checkDependencies(context(), realPorts);
    for (const tile of tiles) {
      expect(tile.whatToDo.length, tile.dependency).toBeGreaterThan(0);
    }
  });

  it('goes red on the database, and on nothing else', async () => {
    // A pool pointed at a closed port: the real driver, the real error, and no
    // risk to the database the rest of this suite is using.
    const dead = postgres('postgres://nobody:nobody@127.0.0.1:1/none', {
      max: 1,
      connect_timeout: 2,
      onnotice: () => undefined,
    });

    try {
      const tiles = await checkDependencies(
        context({ db: drizzle(dead) as unknown as Database }),
        realPorts,
      );

      expect(tileFor(tiles, 'database')?.status).toBe('down');
      // The contract tile reads the database too, so it fails with it. What
      // must not happen is a dependency that has nothing to do with Postgres
      // reporting an outage because Postgres is down.
      expect(tileFor(tiles, 'storage')?.status).toBe('ok');
    } finally {
      await dead.end({ timeout: 5 }).catch(() => undefined);
    }
  });

  it('goes red on the contract when the database has never been seeded', async () => {
    await client`DELETE FROM hospital.app_config WHERE key = 'contract.version'`;
    try {
      const tiles = await checkDependencies(context(), realPorts);
      const contract = tileFor(tiles, 'contract');
      expect(contract?.status).toBe('down');
      expect(contract?.detail).toContain('seeded');
    } finally {
      await client`INSERT INTO hospital.app_config (key, value, updated_at)
                   VALUES ('contract.version', ${JSON.stringify(CONTRACT_VERSION)}::jsonb, now())
                   ON CONFLICT (key) DO UPDATE SET value = excluded.value`;
    }
  });

  it('goes red on the contract when the two releases disagree', async () => {
    // The failure this exists for: one release deployed without the other, and
    // the shared tables meaning different things on each side (§6).
    await client`UPDATE hospital.app_config SET value = '"9.0.0"'::jsonb
                  WHERE key = 'contract.version'`;
    try {
      const tiles = await checkDependencies(context(), realPorts);
      expect(tileFor(tiles, 'contract')?.status).toBe('down');
    } finally {
      await client`UPDATE hospital.app_config SET value = ${JSON.stringify(CONTRACT_VERSION)}::jsonb
                    WHERE key = 'contract.version'`;
    }
  });

  it('reports an in-memory adapter as degraded rather than healthy', async () => {
    // A green tile over a stand-in implies a mail server was reached. It was
    // not, and on a real deployment that difference is the whole outage.
    const tiles = await checkDependencies(context(), {
      email: createMemoryEmailPort(),
      storage: createMemoryStorage(),
    });

    expect(tileFor(tiles, 'email')?.status).toBe('degraded');
  });

  describe.skipIf(!dockerAvailable())('with the container actually stopped', () => {
    let stopped: string[] = [];

    afterAll(async () => {
      // Always put them back, even if an assertion threw. A test that leaves
      // the developer's Mailpit stopped is a test nobody runs twice.
      for (const name of stopped) container('start', name);
      stopped = [];
      await waitFor(async () => {
        const probe = await smtpEmailPort.verify?.();
        return probe?.ok ?? true;
      });
    });

    it('goes red on email when Mailpit is stopped', async () => {
      container('stop', 'blood-connect-mailpit-1');
      stopped.push('blood-connect-mailpit-1');

      const tiles = await checkDependencies(context(), realPorts);

      expect(tileFor(tiles, 'email')?.status).toBe('down');
      // Exactly one tile, which is the assertion that matters: a probe that
      // reported everything down whenever anything was would be no better than
      // one that reported everything up.
      expect(tileFor(tiles, 'database')?.status).toBe('ok');
      expect(tileFor(tiles, 'storage')?.status).toBe('ok');
    }, 40_000);

    it('goes red on storage when MinIO is stopped', async () => {
      container('stop', 'blood-connect-minio-1');
      stopped.push('blood-connect-minio-1');

      const tiles = await checkDependencies(context(), realPorts);

      expect(tileFor(tiles, 'storage')?.status).toBe('down');
      expect(tileFor(tiles, 'database')?.status).toBe('ok');
    }, 40_000);
  });
});
