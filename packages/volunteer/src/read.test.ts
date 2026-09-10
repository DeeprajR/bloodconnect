import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { CONFIG_DEFAULTS } from '@blood-connect/config';
import { donorDemand } from '@blood-connect/db';
import { idGenerator, newId } from '@blood-connect/ids';
import { createFakeClock } from '@blood-connect/testing';
import {
  anonymousActor,
  argon2Hasher,
  nodeTokens,
  type Actor,
  type Database,
  type UseCaseContext,
} from '@blood-connect/platform';

import { demandsForGroup, groupPressure, publicBoard, trend } from './read.js';
import { scopeFor } from './scope.js';

const testUrl = process.env['TEST_DATABASE_URL'];

const CENTRE_ID = '01930000-0000-7000-8000-000000000001';
const DISTRICT = 'TEST_VOL_DISTRICT';
const OTHER_DISTRICT = 'TEST_VOL_ELSEWHERE';
const CITY = 'TEST_VOL_CITY';
const START = '2026-09-09T09:00:00.000Z';

describe.skipIf(!testUrl)('the volunteer board (§6)', () => {
  const client = postgres(testUrl ?? '', { max: 5, onnotice: () => undefined });
  const db = drizzle(client) as unknown as Database;
  const clock = createFakeClock(START);

  const context = (actor: Actor = anonymousActor): UseCaseContext => ({
    db,
    clock,
    ids: idGenerator,
    ports: { hasher: argon2Hasher, tokens: nodeTokens },
    actor,
    correlationId: newId(),
    config: CONFIG_DEFAULTS,
  });

  const volunteer = (districtScopeId: string | null): Actor => ({
    kind: 'user',
    userId: newId(),
    role: 'volunteer_admin',
    districtScopeId,
  });

  type Demand = {
    group?: string;
    units?: number;
    confirmed?: number;
    notified?: number;
    completed?: number;
    status?: string;
    trigger?: 'request_shortfall' | 'stock_floor';
    district?: string;
    city?: string | null;
    hospital?: string;
    dateRequired?: string;
  };

  const raise = async (demand: Demand = {}): Promise<string> => {
    const id = newId();
    const trigger = demand.trigger ?? 'request_shortfall';
    await db.insert(donorDemand).values({
      id,
      centreId: CENTRE_ID,
      trigger,
      // A shortfall demand names its request; a floor demand answers none.
      // Module 4 never reads the request. The constraint does.
      bloodRequestId: trigger === 'request_shortfall' ? requestId : null,
      bloodGroup: demand.group ?? 'O+',
      product: 'whole_blood',
      units: demand.units ?? 4,
      dateRequired: demand.dateRequired ?? '2026-09-10',
      hospitalName: demand.hospital ?? 'Government Medical College',
      hospitalAddress: 'Somewhere',
      districtId: demand.district ?? DISTRICT,
      cityId: demand.city === undefined ? CITY : demand.city,
      status: demand.status ?? 'open',
      donorsNotified: demand.notified ?? 0,
      confirmedUnits: demand.confirmed ?? 0,
      completedUnits: demand.completed ?? 0,
    });
    return id;
  };

  let requestId: string;

  beforeEach(async () => {
    clock.set(new Date(START));

    await client`TRUNCATE hospital.donor_demand_confirmations, hospital.donor_demand,
                          hospital.blood_requests, hospital.users
                 RESTART IDENTITY CASCADE`;
    await client`INSERT INTO hospital.centres (id, name)
                 VALUES (${CENTRE_ID}, 'Test centre') ON CONFLICT (id) DO NOTHING`;
    await client`INSERT INTO reference.location_dataset_versions (version, source)
                 VALUES ('test', 'vitest') ON CONFLICT (version) DO NOTHING`;
    await client`INSERT INTO reference.location_nodes
                   (id, level, kind, parent_id, name, name_normalised, dataset_version)
                 VALUES (${DISTRICT}, 'district', 'district', NULL, 'Test District',
                         'test district', 'test')
                 ON CONFLICT (id) DO NOTHING`;
    await client`INSERT INTO reference.location_nodes
                   (id, level, kind, parent_id, name, name_normalised, dataset_version)
                 VALUES (${CITY}, 'city', 'municipality', ${DISTRICT}, 'Kozhikode',
                         'kozhikode', 'test')
                 ON CONFLICT (id) DO NOTHING`;
    await client`INSERT INTO reference.location_nodes
                   (id, level, kind, parent_id, name, name_normalised, dataset_version)
                 VALUES (${OTHER_DISTRICT}, 'district', 'district', NULL, 'Elsewhere',
                         'elsewhere', 'test')
                 ON CONFLICT (id) DO NOTHING`;

    // One request for every shortfall demand to point at. Module 4 cannot read
    // it and does not want to; the check constraint on `donor_demand` is what
    // needs it to exist.
    const doctorId = newId();
    await client`INSERT INTO hospital.users (id, email, full_name, role, status, password_hash)
                 VALUES (${doctorId}, ${`vol-${doctorId}@blood-connect.invalid`},
                         'Fixture Doctor', 'doctor', 'active', 'x')`;
    requestId = newId();
    await client`INSERT INTO hospital.blood_requests
                   (id, request_id, centre_id, doctor_id, status, urgency, blood_group,
                    product, units, date_required, submitted_at, doctor_snapshot)
                 VALUES (${requestId}, '090926-00001', ${CENTRE_ID}, ${doctorId},
                         'submitted', 'urgent', 'O+', 'whole_blood', 4, '2026-09-10',
                         now(), '{}'::jsonb)`;
  });

  afterAll(async () => {
    await client`DELETE FROM hospital.donor_demand`;
    await client`DELETE FROM hospital.blood_requests`;
    await client`DELETE FROM reference.location_nodes WHERE id LIKE 'TEST_VOL%'`;
    await client.end({ timeout: 5 });
  });

  /* ----------------------------------------------------------------- tiles */

  it('always shows eight groups, in the clinical reading order', async () => {
    const tiles = await groupPressure(context());

    expect(tiles.map((t) => t.bloodGroup)).toEqual([
      'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-',
    ]);
    // A quiet group is shown as covered, never omitted: a missing tile makes a
    // volunteer wonder whether it is covered or merely broken.
    expect(tiles.every((t) => t.level === 'met')).toBe(true);
  });

  it('adds up every open demand for a group', async () => {
    await raise({ group: 'O-', units: 4, confirmed: 1, notified: 12 });
    await raise({ group: 'O-', units: 6, confirmed: 2, notified: 8, hospital: 'District' });

    const tile = (await groupPressure(context())).find((t) => t.bloodGroup === 'O-');

    expect(tile?.unitsRequired).toBe(10);
    expect(tile?.unitsConfirmed).toBe(3);
    expect(tile?.unitsOutstanding).toBe(7);
    expect(tile?.donorsNotified).toBe(20);
    expect(tile?.openDemands).toBe(2);
    expect(tile?.level).toBe('short');
  });

  it('counts a closed demand as nothing outstanding', async () => {
    await raise({ group: 'B+', units: 5, status: 'fulfilled' });
    await raise({ group: 'B+', units: 5, status: 'cancelled' });
    await raise({ group: 'B+', units: 5, status: 'expired' });

    const tile = (await groupPressure(context())).find((t) => t.bloodGroup === 'B+');
    expect(tile?.unitsRequired).toBe(0);
    expect(tile?.level).toBe('met');
  });

  it('reads the shelf from a stock-floor demand, not from the bags', async () => {
    // §6 gives Module 4 no access to inventory. A group under its floor is a
    // group the centre has raised a `stock_floor` demand for (§4).
    await raise({ group: 'AB-', trigger: 'stock_floor', units: 2, confirmed: 2 });

    const tile = (await groupPressure(context())).find((t) => t.bloodGroup === 'AB-');
    expect(tile?.belowFloor).toBe(true);
    // Fully confirmed, and still not green, because the shelf is still low.
    expect(tile?.level).toBe('short');
  });

  /* ------------------------------------------------------------- behind it */

  it('lists the demands behind a tile, soonest first, with the town', async () => {
    await raise({ group: 'A+', dateRequired: '2026-09-14', hospital: 'Later' });
    await raise({ group: 'A+', dateRequired: '2026-09-11', hospital: 'Sooner' });
    await raise({ group: 'O+', dateRequired: '2026-09-10', hospital: 'Another group' });

    const lines = await demandsForGroup(context(), 'A+');

    expect(lines.map((l) => l.hospitalName)).toEqual(['Sooner', 'Later']);
    expect(lines[0]?.town).toBe('Kozhikode');
  });

  it('keeps a stock-floor demand that has no town', async () => {
    // A left join, not an inner one: `city_id` is null on a floor demand, and
    // an inner join would drop exactly the demands that mean the shelf is low.
    await raise({ group: 'B-', trigger: 'stock_floor', city: null });

    const lines = await demandsForGroup(context(), 'B-');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.town).toBeNull();
    expect(lines[0]?.forStockFloor).toBe(true);
  });

  /* -------------------------------------------------------------- scoping */

  it('scopes a volunteer to their own district', async () => {
    await raise({ group: 'O-', units: 4, district: DISTRICT });
    await raise({ group: 'O-', units: 9, district: OTHER_DISTRICT });

    const scoped = scopeFor(volunteer(DISTRICT));
    const mine = (await groupPressure(context(), scoped)).find((t) => t.bloodGroup === 'O-');
    expect(mine?.unitsRequired).toBe(4);

    const everywhere = scopeFor(volunteer(null));
    const all = (await groupPressure(context(), everywhere)).find((t) => t.bloodGroup === 'O-');
    expect(all?.unitsRequired).toBe(13);
  });

  it('takes the scope from the actor, never from the caller', () => {
    // A scoped volunteer cannot widen their own view by editing a query
    // string, because nothing reads one.
    expect(scopeFor(volunteer(DISTRICT))).toEqual({ districtId: DISTRICT });
    expect(scopeFor(volunteer(null))).toEqual({ districtId: null });
    expect(scopeFor(anonymousActor)).toEqual({ districtId: null });
  });

  /* --------------------------------------------------------- public board */

  it('publishes five fields and no more (§14)', async () => {
    await raise({ group: 'O-', units: 4, confirmed: 1 });

    const [row] = await publicBoard(context());

    // Pinned, not sampled. A column that arrives here by being convenient
    // somewhere else fails this test rather than reaching the public web.
    expect(row && Object.keys(row).sort()).toEqual([
      'bloodGroup',
      'hospitalName',
      'neededBy',
      'town',
      'unitsOutstanding',
    ]);
    expect(row?.unitsOutstanding).toBe(3);
  });

  it('leaves a covered demand off the public board', async () => {
    await raise({ group: 'A-', units: 3, confirmed: 3 });
    await raise({ group: 'A+', units: 3, confirmed: 1 });

    const rows = await publicBoard(context());
    expect(rows.map((r) => r.bloodGroup)).toEqual(['A+']);
  });

  it('shows the whole state on the public board, whoever is reading', async () => {
    await raise({ group: 'O-', district: DISTRICT });
    await raise({ group: 'O-', district: OTHER_DISTRICT });

    // No account, no scoping: one page anybody can open or forward (§9.4).
    expect(await publicBoard(context(volunteer(DISTRICT)))).toHaveLength(2);
  });

  /* --------------------------------------------------------------- trend */

  it('buckets units asked for against units met, by week', async () => {
    await raise({ group: 'O+', units: 6, completed: 4, dateRequired: '2026-09-09' });
    await raise({ group: 'O+', units: 2, completed: 2, dateRequired: '2026-09-11' });
    await raise({ group: 'O+', units: 5, completed: 1, dateRequired: '2026-09-02' });

    const points = await trend(context(), { weeks: 6, group: 'O+' });

    expect(points.map((p) => p.weekStart)).toEqual(['2026-08-31', '2026-09-07']);
    expect(points[0]).toMatchObject({ unitsRequired: 5, unitsMet: 1 });
    expect(points[1]).toMatchObject({ unitsRequired: 8, unitsMet: 6 });
  });

  it('counts history whatever a demand ended as', async () => {
    // Met vs missed is the question, and a cancelled demand missed. Filtering
    // to open rows would make the trend a picture of right now, twice.
    await raise({ group: 'AB+', units: 4, completed: 0, status: 'expired' });

    const [point] = await trend(context(), { weeks: 6, group: 'AB+' });
    expect(point).toMatchObject({ unitsRequired: 4, unitsMet: 0 });
  });

  it('stops at the window', async () => {
    await raise({ group: 'B+', units: 4, dateRequired: '2026-05-01' });
    expect(await trend(context(), { weeks: 6, group: 'B+' })).toEqual([]);
  });
});
