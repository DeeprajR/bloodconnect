import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';

/**
 * §5.1, asserted rather than reviewed.
 *
 * §11.5 asks for ownership the database itself enforces, and the point of that
 * is that it holds when the application logic is wrong. These tests connect **as
 * the application roles** and check what they cannot do, which is the half of a
 * grant that never gets exercised by normal use and therefore never fails until
 * it matters.
 *
 * The column-level grants on `hospital.donor_demand` are the third of the three
 * defences §11.2 asks for, and the only one that still holds when the
 * application logic is wrong. So they are asserted from the roles themselves,
 * below, rather than reviewed in the migration.
 */

const testUrl = process.env['TEST_DATABASE_URL'];

/** Reuses the test URL's host and port with a different role's credentials. */
function asRole(role: 'app_web' | 'app_bot'): string {
  if (!testUrl) throw new Error('TEST_DATABASE_URL is not set');
  const url = new URL(testUrl);
  url.username = role;
  url.password = role;
  return url.toString();
}

describe.skipIf(!testUrl)('grants on the reference schema (§5.1)', () => {
  const connections: postgres.Sql[] = [];

  const connect = (role: 'app_web' | 'app_bot'): postgres.Sql => {
    const sql = postgres(asRole(role), { max: 1, onnotice: () => undefined });
    connections.push(sql);
    return sql;
  };

  let web: postgres.Sql;
  let bot: postgres.Sql;

  beforeAll(() => {
    web = connect('app_web');
    bot = connect('app_bot');
  });

  afterAll(async () => {
    await Promise.all(connections.map((c) => c.end({ timeout: 5 })));
  });

  it('lets both applications read the hierarchy', async () => {
    for (const [role, sql] of [
      ['app_web', web],
      ['app_bot', bot],
    ] as const) {
      const rows = await sql`SELECT count(*)::int AS n FROM reference.location_nodes`;
      expect(rows[0]?.['n'], role).toBeTypeOf('number');
    }
  });

  it('lets neither application write it', async () => {
    // The hierarchy is seeded and versioned by the migrator (§5). An
    // application that could insert a place would fragment the donor pool the
    // first time someone typed a new spelling.
    for (const [role, sql] of [
      ['app_web', web],
      ['app_bot', bot],
    ] as const) {
      await expect(
        sql`INSERT INTO reference.location_nodes
              (id, level, kind, parent_id, name, name_normalised, dataset_version)
            VALUES ('X', 'district', 'district', NULL, 'X', 'x', 'v')`,
        role,
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it('lets neither application create a table in it', async () => {
    for (const [role, sql] of [
      ['app_web', web],
      ['app_bot', bot],
    ] as const) {
      await expect(
        sql`CREATE TABLE reference.sneaky (id text)`,
        role,
      ).rejects.toThrow(/permission denied/i);
    }
  });
});

describe.skipIf(!testUrl)('the seeded hierarchy', () => {
  let sql: postgres.Sql;

  beforeAll(() => {
    sql = postgres(asRole('app_bot'), { max: 1, onnotice: () => undefined });
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('holds the four levels in order, or holds nothing yet', async () => {
    const rows = await sql<{ level: string; n: number }[]>`
      SELECT level, count(*)::int AS n FROM reference.location_nodes GROUP BY level
    `;
    if (rows.length === 0) return; // not seeded in this database; nothing to check

    const byLevel = new Map(rows.map((r) => [r.level, r.n]));
    expect(byLevel.get('district')).toBe(1);
    expect(byLevel.get('city') ?? 0).toBeGreaterThan(0);
    expect(byLevel.get('town') ?? 0).toBeGreaterThan(0);
  });

  it('gives every non-district node a parent (§5.8)', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM reference.location_nodes
       WHERE level <> 'district' AND parent_id IS NULL
    `;
    expect(row?.n).toBe(0);
  });
});

describe.skipIf(!testUrl)('grants on the account update queue (§3, §5.1)', () => {
  const connections: postgres.Sql[] = [];

  const connect = (role: 'app_web' | 'app_bot'): postgres.Sql => {
    const sql = postgres(asRole(role), { max: 1, onnotice: () => undefined });
    connections.push(sql);
    return sql;
  };

  let migrator: postgres.Sql;
  let web: postgres.Sql;
  let bot: postgres.Sql;
  let userId: string;
  let requestId: string;

  beforeAll(async () => {
    migrator = postgres(testUrl ?? '', { max: 1, onnotice: () => undefined });
    connections.push(migrator);
    web = connect('app_web');
    bot = connect('app_bot');

    const [user] = await migrator`
      INSERT INTO hospital.users (id, email, full_name, role, status, password_hash)
      VALUES (gen_random_uuid(), 'grants-probe@blood-connect.invalid', 'Grants Probe',
              'doctor', 'active', 'x')
      RETURNING id`;
    userId = String(user?.['id']);

    const [row] = await migrator`
      INSERT INTO hospital.account_update_requests
        (id, user_id, field, current_value, proposed_value, reason)
      VALUES (gen_random_uuid(), ${userId}, 'full_name', 'Grants Probe',
              'Grants Probe Two', 'A probe.')
      RETURNING id`;
    requestId = String(row?.['id']);
  });

  afterAll(async () => {
    await migrator`DELETE FROM hospital.account_update_requests WHERE user_id = ${userId}`;
    await migrator`DELETE FROM hospital.users WHERE id = ${userId}`;
    await Promise.all(connections.map((c) => c.end({ timeout: 5 })));
  });

  it('lets the staff app raise and decide', async () => {
    const rows = await web`
      SELECT count(*)::int AS n FROM hospital.account_update_requests`;
    expect(rows[0]?.['n']).toBeTypeOf('number');

    await expect(
      web`UPDATE hospital.account_update_requests
            SET admin_note = 'probe' WHERE id = ${requestId}`,
    ).resolves.toBeDefined();
  });

  it('will not let the staff app delete a decision', async () => {
    // A rejected request is the record of a decision about somebody's clinical
    // identity (§14). Nothing in the application has a reason to remove one.
    await expect(
      web`DELETE FROM hospital.account_update_requests WHERE id = ${requestId}`,
    ).rejects.toThrow(/permission denied/i);
  });

  it('keeps the bot out of hospital accounts entirely', async () => {
    await expect(
      bot`SELECT count(*) FROM hospital.account_update_requests`,
    ).rejects.toThrow(/permission denied/i);
  });
});
