import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';

import {
  DONOR_DEMAND_COLUMNS,
  DONOR_DEMAND_CONFIRMATION_COLUMNS,
  canBotWrite,
  canCentreWrite,
  canBotWriteConfirmation,
  canCentreWriteConfirmation,
} from '@blood-connect/contract';

/**
 * The shared contract, enforced by the database (§5.1, §6, §7, §11.2).
 *
 * §11.2 names a one-sided change to `donor_demand` as the single most likely
 * way this system breaks in production. `packages/contract` states the
 * ownership as data; this file connects **as each application role** and proves
 * the database agrees, because the package is a convention two codebases have
 * to keep, and the grant is a fact neither of them can get around.
 *
 * The three checks worth reading:
 *
 *  - The bot cannot set `units`. Only the centre knows how much blood is needed.
 *  - The centre cannot set `confirmed_units`. Only the bot knows who said yes.
 *  - The lists in `packages/contract` and the grants in migration 0010 are the
 *    same lists, asserted column by column rather than by eye.
 */

const testUrl = process.env['TEST_DATABASE_URL'];
const CENTRE_ID = '01930000-0000-7000-8000-000000000001';
const DISTRICT_ID = 'TEST_DISTRICT_GRANTS';

function asRole(role: 'app_web' | 'app_bot'): string {
  if (!testUrl) throw new Error('TEST_DATABASE_URL is not set');
  const url = new URL(testUrl);
  url.username = role;
  url.password = role;
  return url.toString();
}

describe.skipIf(!testUrl)('the contract tables, as the application roles', () => {
  let migrator: postgres.Sql;
  let web: postgres.Sql;
  let bot: postgres.Sql;
  let demandId: string;

  beforeAll(() => {
    migrator = postgres(testUrl ?? '', { max: 1, onnotice: () => undefined });
    web = postgres(asRole('app_web'), { max: 1, onnotice: () => undefined });
    bot = postgres(asRole('app_bot'), { max: 1, onnotice: () => undefined });
  });

  afterAll(async () => {
    // Shared reference data: another suite asserts the seed loaded exactly one
    // district, so this one removes the district it brought.
    await migrator`DELETE FROM hospital.donor_demand_confirmations`;
    await migrator`DELETE FROM hospital.donor_demand`;
    await migrator`DELETE FROM reference.location_nodes WHERE id LIKE 'TEST%'`;
    await Promise.all([migrator, web, bot].map((c) => c.end({ timeout: 5 })));
  });

  beforeEach(async () => {
    await migrator`DELETE FROM hospital.donor_demand_confirmations`;
    await migrator`DELETE FROM hospital.donor_demand`;
    await migrator`INSERT INTO hospital.centres (id, name)
                   VALUES (${CENTRE_ID}, 'Test centre') ON CONFLICT (id) DO NOTHING`;
    await migrator`INSERT INTO reference.location_dataset_versions (version, source)
                   VALUES ('test', 'vitest') ON CONFLICT (version) DO NOTHING`;
    await migrator`INSERT INTO reference.location_nodes
                     (id, level, kind, parent_id, name, name_normalised, dataset_version)
                   VALUES (${DISTRICT_ID}, 'district', 'district', NULL, 'Grants District',
                           'grants district', 'test')
                   ON CONFLICT (id) DO NOTHING`;

    const [row] = await migrator<{ id: string }[]>`
      INSERT INTO hospital.donor_demand
        (id, centre_id, trigger, blood_group, product, units, date_required,
         hospital_name, hospital_address, district_id, status)
      VALUES (gen_random_uuid(), ${CENTRE_ID}, 'stock_floor', 'O-', 'whole_blood', 5,
              CURRENT_DATE, 'Test centre', 'Test address', ${DISTRICT_ID}, 'open')
      RETURNING id
    `;
    demandId = row?.id ?? '';
  });

  /* --------------------------------------------------------------- the bot */

  it('lets the bot read a demand and write back its own progress', async () => {
    const rows = await bot`SELECT id, units FROM hospital.donor_demand WHERE id = ${demandId}`;
    expect(rows[0]?.['units']).toBe(5);

    await bot`UPDATE hospital.donor_demand
                 SET bot_public_id = 'BC-001', imported_at = now(),
                     donors_notified = 20, confirmed_units = 2
               WHERE id = ${demandId}`;

    const [after] = await migrator`SELECT confirmed_units FROM hospital.donor_demand
                                    WHERE id = ${demandId}`;
    expect(after?.['confirmed_units']).toBe(2);
  });

  it('does not let the bot change how much blood is needed', async () => {
    // The number of units is the centre's statement of clinical need. A bot
    // that could edit it could quietly close a demand by shrinking it.
    await expect(
      bot`UPDATE hospital.donor_demand SET units = 1 WHERE id = ${demandId}`,
    ).rejects.toThrow(/permission denied/i);
  });

  it('does not let the bot raise or delete a demand', async () => {
    await expect(
      bot`INSERT INTO hospital.donor_demand
            (id, centre_id, trigger, blood_group, product, units, date_required,
             hospital_name, hospital_address, district_id)
          VALUES (gen_random_uuid(), ${CENTRE_ID}, 'stock_floor', 'A+', 'whole_blood', 1,
                  CURRENT_DATE, 'x', 'y', ${DISTRICT_ID})`,
    ).rejects.toThrow(/permission denied/i);

    await expect(
      bot`DELETE FROM hospital.donor_demand WHERE id = ${demandId}`,
    ).rejects.toThrow(/permission denied/i);
  });

  it('does not let the bot see anything else in the hospital schema', async () => {
    // §5.1's privacy boundary is a missing grant, not a convention: a careless
    // join from the bot cannot reach a patient.
    await expect(bot`SELECT count(*) FROM hospital.patients`).rejects.toThrow(
      /permission denied/i,
    );
    await expect(bot`SELECT count(*) FROM hospital.blood_bags`).rejects.toThrow(
      /permission denied/i,
    );
  });

  /* ------------------------------------------------------------ the centre */

  it('lets the centre raise a demand and cancel it', async () => {
    await web`INSERT INTO hospital.donor_demand
                (id, centre_id, trigger, blood_group, product, units, date_required,
                 hospital_name, hospital_address, district_id)
              VALUES (gen_random_uuid(), ${CENTRE_ID}, 'stock_floor', 'B-', 'whole_blood', 4,
                      CURRENT_DATE, 'Test centre', 'Test address', ${DISTRICT_ID})`;

    await web`UPDATE hospital.donor_demand SET status = 'cancelled' WHERE id = ${demandId}`;

    const [row] = await migrator`SELECT status FROM hospital.donor_demand WHERE id = ${demandId}`;
    expect(row?.['status']).toBe('cancelled');
  });

  it('does not let the centre write a recruitment count', async () => {
    // Only the bot knows whether anybody said yes. A centre that could set this
    // could show a demand as met by donors who were never asked.
    await expect(
      web`UPDATE hospital.donor_demand SET confirmed_units = 99 WHERE id = ${demandId}`,
    ).rejects.toThrow(/permission denied/i);

    await expect(
      web`UPDATE hospital.donor_demand SET bot_public_id = 'forged' WHERE id = ${demandId}`,
    ).rejects.toThrow(/permission denied/i);
  });

  it('does not let the centre delete a demand', async () => {
    await expect(
      web`DELETE FROM hospital.donor_demand WHERE id = ${demandId}`,
    ).rejects.toThrow(/permission denied/i);
  });

  /* --------------------------------------------------------------- roster */

  it('lets the bot create a roster row and the centre record the outcome', async () => {
    const donorId = crypto.randomUUID();
    await bot`INSERT INTO hospital.donor_demand_confirmations
                (id, demand_id, donor_id, channel, donor_name, donor_phone, blood_group)
              VALUES (gen_random_uuid(), ${demandId}, ${donorId}, 'telegram',
                      'Synthetic Donor', '+910000000000', 'O-')`;

    await web`UPDATE hospital.donor_demand_confirmations
                 SET status = 'completed', donated_at = CURRENT_DATE, bag_identifier = 'SYN-1'
               WHERE demand_id = ${demandId}`;

    const [row] = await migrator`SELECT status, bag_identifier
                                   FROM hospital.donor_demand_confirmations
                                  WHERE demand_id = ${demandId}`;
    expect(row?.['status']).toBe('completed');
    expect(row?.['bag_identifier']).toBe('SYN-1');
  });

  it('does not let the centre invent a roster row', async () => {
    // Someone who never confirmed in the bot is recorded as a walk-in, which is
    // its own flow with its own record, not a fabricated confirmation (§4).
    await expect(
      web`INSERT INTO hospital.donor_demand_confirmations
            (id, demand_id, donor_id, channel, donor_name, donor_phone, blood_group)
          VALUES (gen_random_uuid(), ${demandId}, gen_random_uuid(), 'telegram',
                  'Invented', '+910000000001', 'O-')`,
    ).rejects.toThrow(/permission denied/i);
  });

  it('does not let the bot record what happened at the counter', async () => {
    const donorId = crypto.randomUUID();
    await bot`INSERT INTO hospital.donor_demand_confirmations
                (id, demand_id, donor_id, channel, donor_name, donor_phone, blood_group)
              VALUES (gen_random_uuid(), ${demandId}, ${donorId}, 'telegram',
                      'Synthetic Donor', '+910000000002', 'O-')`;

    // The counter is the authority on who actually gave blood (§4).
    await expect(
      bot`UPDATE hospital.donor_demand_confirmations
             SET donated_at = CURRENT_DATE WHERE demand_id = ${demandId}`,
    ).rejects.toThrow(/permission denied/i);
  });

  /* ----------------------------------------- the package and the migration */

  it('grants exactly the columns packages/contract claims', async () => {
    const grants = await migrator<{ grantee: string; column_name: string }[]>`
      SELECT grantee, column_name
        FROM information_schema.column_privileges
       WHERE table_schema = 'hospital'
         AND table_name = 'donor_demand'
         AND privilege_type = 'UPDATE'
         AND grantee IN ('app_web', 'app_bot')
    `;

    const actual = (role: string): string[] =>
      grants
        .filter((row) => row.grantee === role)
        .map((row) => row.column_name)
        .sort();

    /**
     * The centre's updatable set is narrower than its ownership set, and that
     * is deliberate. `id`, `centre_id`, `blood_group`, `units` and the rest
     * describe what was asked for and are written once. A grant to update them
     * would be a grant to rewrite a demand donors have already been shown.
     */
    const centreUpdatable = actual('app_web');
    expect(centreUpdatable).toEqual(['notes', 'status', 'updated_at']);
    expect(centreUpdatable.every((column) => canCentreWrite(column as never))).toBe(true);

    // Neither side holds a grant the package says belongs to the other. `status`
    // is the one column both may move, which is why it is excluded here.
    const botOnly = DONOR_DEMAND_COLUMNS.filter(
      (column) => canBotWrite(column) && !canCentreWrite(column),
    );
    expect(centreUpdatable.filter((column) => botOnly.includes(column as never))).toEqual([]);

    const botUpdatable = actual('app_bot');
    expect(botUpdatable).toEqual(
      DONOR_DEMAND_COLUMNS.filter(canBotWrite).slice().sort(),
    );
    // The one that matters most: the bot has no grant on `units`.
    expect(botUpdatable).not.toContain('units');
  });

  it('grants the counter exactly the roster columns packages/contract claims', async () => {
    const grants = await migrator<{ column_name: string }[]>`
      SELECT column_name
        FROM information_schema.column_privileges
       WHERE table_schema = 'hospital'
         AND table_name = 'donor_demand_confirmations'
         AND privilege_type = 'UPDATE'
         AND grantee = 'app_web'
    `;

    const actual = grants.map((row) => row.column_name).sort();
    const expected = DONOR_DEMAND_CONFIRMATION_COLUMNS.filter((column) =>
      canCentreWriteConfirmation(column),
    )
      .slice()
      .sort();

    expect(actual).toEqual(expected);
  });

  it('keeps the migration and the package agreeing on the column list', async () => {
    const columns = await migrator<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'hospital' AND table_name = 'donor_demand'
    `;

    // §6: the shared suite asserts the migration's actual column list matches
    // the schema. A column added on one side and not the other is exactly the
    // failure this is here to catch.
    expect(columns.map((row) => row.column_name).sort()).toEqual(
      [...DONOR_DEMAND_COLUMNS].sort(),
    );

    const confirmationColumns = await migrator<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'hospital' AND table_name = 'donor_demand_confirmations'
    `;
    expect(confirmationColumns.map((row) => row.column_name).sort()).toEqual(
      [...DONOR_DEMAND_CONFIRMATION_COLUMNS].sort(),
    );

    // And the bot's insertable list is a real subset, since Postgres has no
    // column-level INSERT to enforce it with.
    expect(
      DONOR_DEMAND_CONFIRMATION_COLUMNS.every(
        (column) => canBotWriteConfirmation(column) || canCentreWriteConfirmation(column),
      ),
    ).toBe(true);
  });
});
