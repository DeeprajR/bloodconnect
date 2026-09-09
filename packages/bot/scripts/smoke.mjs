/**
 * The bot's writes, run as `app_bot` against the real database.
 *
 * `TEST_DATABASE_URL` connects as `migrator`, which holds every privilege, so a
 * green suite says nothing about whether the grants permit the code that has to
 * run under them. That gap has bitten twice already — ADR 0005 on
 * `centre_decisions`, ADR 0008 on `donor_demand_confirmations` — and P7 adds a
 * third case: erasure has to reach the roster, which needs a grant the bot did
 * not have until migration 0016.
 *
 * So this walks the interview, the profile edit and the erasure as the role the
 * bot process really uses, and then asserts what that role must **not** be able
 * to do.
 *
 * Synthetic records only. Nothing here touches a real donor.
 */
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

import { CONFIG_DEFAULTS } from '@blood-connect/config';
import { idGenerator, newId } from '@blood-connect/ids';
import { APP_TIMEZONE, dayOf } from '@blood-connect/domain';
import {
  answerContact,
  answerInterview,
  beginInterview,
  createChannelRegistry,
  createMemoryChannel,
  deleteDonorData,
  draftFromProfile,
  findDonorByAddress,
  loadInterview,
  remindAbandonedSignups,
} from '@blood-connect/bot';

const botUrl = process.env.BOT_DATABASE_URL;
const migratorUrl = process.env.MIGRATION_DATABASE_URL;

if (!botUrl || !migratorUrl) {
  console.error('BOT_DATABASE_URL and MIGRATION_DATABASE_URL must both be set.');
  process.exit(1);
}
if (!/app_bot/.test(botUrl)) {
  // The whole point is the reduced role.
  console.error('BOT_DATABASE_URL must connect as app_bot. That is what this checks.');
  process.exit(1);
}

const bot = postgres(botUrl, { max: 4, onnotice: () => undefined });
const admin = postgres(migratorUrl, { max: 2, onnotice: () => undefined });
const db = drizzle(bot);

const clock = { now: () => new Date(), today: () => dayOf(new Date(), APP_TIMEZONE) };
const channel = createMemoryChannel();

const ctx = () => ({
  db,
  clock,
  ids: idGenerator,
  channel: createChannelRegistry(channel),
  config: CONFIG_DEFAULTS,
  correlationId: newId(),
});

const WHO = {
  channel: 'memory',
  channelUserId: `smoke-${randomBytes(4).toString('hex')}`,
};

let failures = 0;
const created = { demands: [] };

const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  BAD  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const attempt = async (label, run) => {
  try {
    const value = await run();
    check(label, true);
    return value;
  } catch (error) {
    // A grant refusal arrives here, wrapped by the driver.
    check(label, false, String(error?.message ?? error).split('\n')[0]);
    return undefined;
  }
};

async function main() {
  const [centre] = await admin`SELECT id FROM hospital.centres LIMIT 1`;
  if (!centre) {
    console.error('No centre row. Run pnpm db:seed first.');
    process.exit(1);
  }

  /* ------------------------------------------------------- the interview */

  console.log('\nthe interview, as app_bot');
  const say = async (text) => answerInterview(ctx(), WHO, text);

  await attempt('an interview begins', () => beginInterview(ctx(), WHO));
  await attempt('a shared contact is accepted', () =>
    answerContact(ctx(), WHO, '+919900000123'),
  );

  const walk = [
    'Synthetic Smoke',
    'dob:y:1994',
    'dob:m:03',
    'dob:d:12',
    'sex:female',
    'group:O-',
    'weight:50_60',
    'durable:no',
    'durable:no',
    'durable:no',
    'durable:no',
  ];
  await attempt('the questions are answered', async () => {
    for (const answer of walk) await say(answer);
  });

  // The location chain, taken from whatever the dataset actually holds.
  const [district] = await admin`SELECT id FROM reference.location_nodes
                                  WHERE level = 'district' LIMIT 1`;
  const [city] = await admin`SELECT id FROM reference.location_nodes
                              WHERE parent_id = ${district?.id ?? ''} LIMIT 1`;
  const [town] = await admin`SELECT id FROM reference.location_nodes
                              WHERE parent_id = ${city?.id ?? ''} LIMIT 1`;

  await attempt('the location chain is walked', async () => {
    await say(`loc:district:${district?.id ?? ''}`);
    if (city) await say(`loc:city:${city.id}`);
    if (town) await say(`loc:town:${town.id}`);
  });

  const state = await loadInterview(ctx(), WHO);
  // Whatever level the chain ended on, the next question is the last donation.
  while ((await loadInterview(ctx(), WHO))?.step === 'location') {
    const current = await loadInterview(ctx(), WHO);
    const [child] = await admin`SELECT id FROM reference.location_nodes
                                 WHERE parent_id = ${
                                   current?.draft.townId ??
                                   current?.draft.cityId ??
                                   current?.draft.districtId ??
                                   ''
                                 } LIMIT 1`;
    if (!child) break;
    await say(`loc:${current?.draft.locationLevel ?? 'locality'}:${child.id}`);
  }
  check('the interview reached the last question', state !== undefined);

  await attempt('the last donation is answered', () => say('donated:never'));

  const registered = await attempt('the acknowledgement commits the donor', () =>
    say('sum:confirm'),
  );
  check('a donor row was written', registered?.kind === 'registered',
    `got ${registered?.kind}`);

  const donorId = registered?.donorId;
  if (!donorId) {
    console.log('\nno donor was created; stopping here');
    return;
  }

  const [consent] = await admin`SELECT wording_version, values_snapshot
                                  FROM bot.donor_consents WHERE donor_id = ${donorId}`;
  check('consent carries the wording version and the values shown',
    consent?.wording_version !== undefined && consent?.values_snapshot !== undefined);

  /* ------------------------------------------------------- profile edit */

  console.log('\nthe profile editor');
  const found = await findDonorByAddress(ctx(), WHO);
  check('the donor is found by their channel', found?.donorId === donorId);

  const draft = await attempt('the profile reads back as a draft', () =>
    draftFromProfile(ctx(), donorId),
  );
  check('with their own answers in it', draft?.name === 'Synthetic Smoke');

  /* ------------------------------------------------------------ erasure */

  console.log('\nerasure, and what it must reach');
  // A donation, as the roster would hold it.
  const demandId = newId();
  created.demands.push(demandId);
  const [free] = await admin`
    SELECT g FROM unnest(ARRAY['O-','O+','A-','A+','B-','B+','AB-','AB+']) AS g
     WHERE NOT EXISTS (
       SELECT 1 FROM hospital.donor_demand d
        WHERE d.blood_group = g AND d.trigger = 'stock_floor' AND d.status = 'open'
          AND d.centre_id = ${centre.id})
     LIMIT 1`;

  if (free) {
    await admin`
      INSERT INTO hospital.donor_demand
        (id, centre_id, trigger, blood_group, product, units, date_required,
         hospital_name, hospital_address, district_id, status)
      VALUES (${demandId}, ${centre.id}, 'stock_floor', ${free.g}, 'whole_blood', 1,
              current_date, 'Smoke centre', 'Nowhere', 'SMOKE', 'open')`;
    await admin`
      INSERT INTO hospital.donor_demand_confirmations
        (id, demand_id, donor_id, channel, donor_name, donor_phone, blood_group,
         status, donated_at, bag_identifier)
      VALUES (${newId()}, ${demandId}, ${donorId}, 'memory', 'Synthetic Smoke',
              '+919900000123', ${free.g}, 'completed', current_date, 'U-SMOKE-1')`;

    const erased = await attempt('erasure runs', () => deleteDonorData(ctx(), donorId));
    check('and reports the donation it kept', erased?.donationsKept === 1,
      `got ${String(erased?.donationsKept)}`);

    const [row] = await admin`SELECT donor_name, donor_phone, bag_identifier, donated_at
                                FROM hospital.donor_demand_confirmations
                               WHERE donor_id = ${donorId}`;
    // The grant migration 0016 exists for. Without it this is where it shows up.
    check('the name is gone from the roster', row?.donor_name === 'Deleted donor',
      `got ${String(row?.donor_name)}`);
    check('the number is gone from the roster',
      !String(row?.donor_phone ?? '').includes('9900000123'));
    // The half that must survive.
    check('the unit number survives', row?.bag_identifier === 'U-SMOKE-1');
    check('the donation date survives', row?.donated_at !== null);

    const phones = await admin`SELECT 1 FROM bot.donor_phones WHERE donor_id = ${donorId}`;
    check('no phone number is left', phones.length === 0);
    const snap = await admin`SELECT values_snapshot FROM bot.donor_consents
                              WHERE donor_id = ${donorId}`;
    check('the consent snapshot no longer names them',
      !JSON.stringify(snap).includes('Synthetic Smoke'));
  } else {
    console.log('  --   every group already has an open floor demand; erasure skipped');
  }

  /* --------------------------------------------- what app_bot must not do */

  console.log('\nwhat app_bot must not be able to do');
  const refused = async (label, statement) => {
    try {
      await statement();
      check(label, false, 'it was allowed');
    } catch (error) {
      check(label, /permission denied/i.test(String(error?.message ?? error)),
        String(error?.message ?? error).split('\n')[0]);
    }
  };

  // The counter is the authority on who gave blood (§4). The bot records who
  // said yes, and nothing about what happened at the desk.
  await refused('rewrite a unit number', () =>
    bot`UPDATE hospital.donor_demand_confirmations SET bag_identifier = 'U-FAKE'`);
  await refused('mark a donation itself', () =>
    bot`UPDATE hospital.donor_demand_confirmations SET donated_at = current_date`);
  await refused('set the group a unit typed as', () =>
    bot`UPDATE hospital.donor_demand_confirmations SET donated_blood_group = 'O+'`);
  // §5.1: everything else in `hospital` is unreachable, blood_bags included.
  await refused('read the register', () => bot`SELECT 1 FROM hospital.blood_bags LIMIT 1`);
  await refused('raise its own demand', () =>
    bot`INSERT INTO hospital.donor_demand (id, centre_id, trigger, blood_group, product,
                                           units, date_required, hospital_name,
                                           hospital_address, district_id)
        VALUES (gen_random_uuid(), ${centre.id}, 'stock_floor', 'O+', 'whole_blood', 1,
                current_date, 'x', 'y', 'z')`);
  await refused('edit its own event log', () => bot`UPDATE bot.event_log SET event = 'x'`);

  /* --------------------------------------------------------------- tidy up */

  await admin`DELETE FROM hospital.donor_demand_confirmations
               WHERE demand_id = ANY(${created.demands})`;
  await admin`DELETE FROM hospital.donor_demand WHERE id = ANY(${created.demands})`;
  await admin`DELETE FROM bot.event_log WHERE subject_id = ${donorId}`;
  await admin`DELETE FROM bot.donor_consents WHERE donor_id = ${donorId}`;
  await admin`DELETE FROM bot.donor_screening_answers WHERE donor_id = ${donorId}`;
  await admin`DELETE FROM bot.donor_phones WHERE donor_id = ${donorId}`;
  await admin`DELETE FROM bot.donor_channels WHERE donor_id = ${donorId}`;
  await admin`DELETE FROM bot.donors WHERE id = ${donorId}`;
  await admin`DELETE FROM bot.conversation_state WHERE channel_user_id = ${WHO.channelUserId}`;
  await admin`DELETE FROM bot.message_outbox WHERE channel_user_id = ${WHO.channelUserId}`;

  console.log(
    failures === 0
      ? '\nTHE BOT RUNS AS app_bot — ALL OK'
      : `\n${failures} problem(s). The grants and the code disagree.`,
  );
}

try {
  await main();
} finally {
  await bot.end({ timeout: 5 });
  await admin.end({ timeout: 5 });
}

process.exit(failures === 0 ? 0 : 1);
