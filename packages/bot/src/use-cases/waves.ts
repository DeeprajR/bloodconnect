/**
 * Selecting a wave (§7.7).
 *
 * Twenty eligible donors, ordered by proximity down the hierarchy and then by
 * longest since donating. This has to be SQL: filtering a donor pool in Node
 * does not scale, and the ordering would be SQL anyway.
 *
 * **The predicate necessarily exists twice**. Here as SQL for the wave, and in
 * `isEligible` below for one donor arriving on a deep link. §11.3 makes the
 * agreement test mandatory, and `waves.test.ts` seeds donors on every boundary
 * (exactly 18, exactly 65, exactly at the weight threshold, one day either side
 * of the interval), runs both, and asserts the sets are identical.
 *
 * Two things the predicate does and does not do, both worth knowing before
 * reading it:
 *
 *  - **The blood group is the donor's own word for it.** It no longer has to
 *    have been typed off a unit first. That rule was circular: a donor is typed
 *    by donating, donates by being asked, and was not asked until typed, so a
 *    pool of new donors stayed permanently silent. Every unit is typed at the
 *    counter before it is used, which is the control that protects the patient.
 *  - **The donation window is checked live, every time.** Nobody who gave
 *    inside their interval is ever selected, whatever else is stored about
 *    them.
 *
 * Both readings take their thresholds from the same `AppConfig` object (§12), so
 * a revised inter-donation interval cannot move one and not the other.
 */

import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { botRequests, donorChannels, donorRequests, donors } from '@blood-connect/db/bot';
import {
  ageOn,
  compatibleDonorGroupsFor,
  hasIntervalElapsed,
  isQualified,
  parseCalendarDay,
  type BloodGroup,
  type CalendarDay,
} from '@blood-connect/domain';
import type { AppConfig } from '@blood-connect/config';

import type { BotContext } from '../context.js';
import { createEventWriter } from '../events.js';
import { MESSAGES, type HospitalSnapshot } from '../messages.js';
import { enqueue, type QueuedMessage } from '../outbox.js';

/** The shape both readings of the predicate agree about. */
export type DonorForEligibility = {
  readonly bloodGroup: string;
  readonly dob: string;
  readonly weightKg: number;
  readonly nextEligibleOn: string | null;
  readonly durableFlagStatus: string;
  readonly snoozeUntil: string | null;
  readonly optedOutAt: Date | null;
  readonly deletedAt: Date | null;
  readonly consentCurrentAt: Date | null;
  /** The judgement written when they answered. See `qualifyDonor`. */
  readonly qualificationStatus: string;
};

/**
 * One donor, checked in TypeScript. The twin of the SQL below.
 *
 * Order of the checks is irrelevant to correctness and deliberate for reading:
 * it runs from "is this a person we may contact at all" outward to the clinical
 * thresholds, which is the order a human would ask them in.
 */
export function isEligible(
  donor: DonorForEligibility,
  need: BloodGroup,
  today: CalendarDay,
  config: AppConfig,
): boolean {
  // May we contact them at all?
  if (donor.optedOutAt !== null) return false;
  if (donor.deletedAt !== null) return false;
  if (donor.consentCurrentAt === null) return false;
  if (donor.snoozeUntil !== null && donor.snoozeUntil > today) return false;

  /**
   * Are they the right person for this request?
   *
   * The group is the one the donor gave us, and it is trusted. It used to have
   * to be typed off a unit first, which sounds careful and is not: a donor is
   * only typed by donating, and they only donate by being asked, so a pool of
   * people who had never given could never be asked and never became typable.
   * The pre-transfusion test is the control that actually protects the patient,
   * and the counter types every unit before it is used regardless.
   */
  const compatible = compatibleDonorGroupsFor(need) as readonly string[];
  if (!compatible.includes(donor.bloodGroup)) return false;

  /**
   * What their answers came to, decided when they gave them (§5).
   *
   * Age, weight and the durable health questions all live behind this one
   * column now, so the two halves of the predicate cannot drift on them: there
   * is nothing left here to get out of step with the SQL.
   */
  if (!isQualified(donor.qualificationStatus)) return false;
  if (donor.durableFlagStatus !== 'clear') return false;

  /**
   * Can they give **today**?
   *
   * The one part of the judgement that is deliberately not stored, because it
   * is a fact about the calendar rather than about the donor. Somebody who gave
   * three weeks ago is not asked again until the interval has run, whatever
   * their qualification says (§5, §12).
   *
   * `date` columns arrive as plain strings; the branded type is what stops a
   * day being compared against an instant somewhere down the line.
   */
  const eligible = parseCalendarDay(donor.nextEligibleOn);
  if (!hasIntervalElapsed(eligible, today)) return false;

  /**
   * Age is checked here as well as being stored.
   *
   * Not redundancy: a qualification written at 64 is still `qualified` at 66,
   * because nothing recomputes it on a birthday. The stored judgement covers
   * the answers, and this covers the passage of time. Same reason the interval
   * is live.
   */
  const age = ageOn(donor.dob as CalendarDay, today);
  // Inclusive at both ends: exactly 18 and exactly 65 are both eligible.
  if (age < config.donor.minAge || age > config.donor.maxAge) return false;
  if (donor.weightKg < config.donor.minWeightKg) return false;

  return true;
}

export type WaveDonor = {
  readonly donorId: string;
  readonly channel: string;
  readonly channelUserId: string;
};

/**
 * The SQL half (§7.7).
 *
 * Ordered by proximity down the four levels, then longest-since-donation with
 * nulls first, somebody who has never donated is at the front, which is both
 * fair and how a pool grows.
 *
 * `NOT EXISTS` against `donor_requests` is what stops a donor being asked twice
 * about the same request across waves.
 */
export async function selectWave(
  ctx: BotContext,
  botRequestId: string,
  need: BloodGroup,
  place: {
    districtId: string | null;
    cityId: string | null;
    townId: string | null;
    localityId: string | null;
  },
  size: number,
): Promise<WaveDonor[]> {
  const today = ctx.clock.today();
  const compatible = compatibleDonorGroupsFor(need);
  const { minAge, maxAge, minWeightKg } = ctx.config.donor;

  const rows = await ctx.db
    .select({
      donorId: donors.id,
      channel: donorChannels.channel,
      channelUserId: donorChannels.channelUserId,
    })
    .from(donors)
    .innerJoin(donorChannels, eq(donorChannels.donorId, donors.id))
    .where(
      and(
        sql`${donors.bloodGroup} = ANY(${sql.raw(`ARRAY[${compatible.map((g) => `'${g}'`).join(',')}]`)})`,
        /**
         * The stored judgement, in front of everything it covers (§5).
         *
         * Age, weight and the health answers were decided when the donor gave
         * them. This is the column that carries the result, and the index
         * `donors_qualified_idx` is built for exactly this shape.
         */
        eq(donors.qualificationStatus, 'qualified'),
        /**
         * The donation window, checked against today and never stored as a
         * verdict. NULL means never donated, which is eligible now; anything
         * else is a date that has to have arrived. This is the guarantee that
         * somebody who gave three weeks ago is not asked again.
         */
        or(isNull(donors.nextEligibleOn), sql`${donors.nextEligibleOn} <= ${today}`),
        /**
         * Age bounds, inclusive at both ends, expressed as birth dates so the
         * comparison stays indexable.
         *
         * The upper bound is **strictly greater than** `today - (max + 1)
         * years`, which is the same boundary as `age <= max`: somebody born
         * exactly 66 years ago today is 66 and excluded, and somebody born a
         * day later is 65 and included. Writing it as `>= ... + 1 day` is the
         * obvious form and is wrong: `date - interval` is a timestamp, and
         * adding an integer to one is not valid SQL at all.
         */
        sql`${donors.dob} <= (${today}::date - make_interval(years => ${minAge}::int))`,
        sql`${donors.dob} > (${today}::date - make_interval(years => (${maxAge}::int + 1)))`,
        sql`${donors.weightKg} >= ${minWeightKg}`,
        eq(donors.durableFlagStatus, 'clear'),
        or(isNull(donors.snoozeUntil), sql`${donors.snoozeUntil} <= ${today}`),
        isNull(donors.optedOutAt),
        isNull(donors.deletedAt),
        sql`${donors.consentCurrentAt} IS NOT NULL`,
        // Asked once per request, however many waves run.
        sql`NOT EXISTS (
          SELECT 1 FROM bot.donor_requests r
           WHERE r.donor_id = ${donors.id} AND r.bot_request_id = ${botRequestId}
        )`,
      ),
    )
    .orderBy(
      sql`CASE
            WHEN ${donors.localityId} IS NOT NULL AND ${donors.localityId} = ${place.localityId} THEN 0
            WHEN ${donors.townId}     IS NOT NULL AND ${donors.townId}     = ${place.townId}     THEN 1
            WHEN ${donors.cityId}     IS NOT NULL AND ${donors.cityId}     = ${place.cityId}     THEN 2
            WHEN ${donors.districtId} IS NOT NULL AND ${donors.districtId} = ${place.districtId} THEN 3
            ELSE 4
          END`,
      sql`${donors.lastDonatedOn} ASC NULLS FIRST`,
    )
    .limit(size);

  return rows;
}

export type WaveResult = {
  readonly waveNo: number;
  readonly notified: number;
  readonly nextWaveAt: Date | null;
};

/**
 * Selects a wave, opens a journey row per donor, and queues the card.
 *
 * `next_wave_at` is set at the end, so the ticker escalates by polling a column
 * rather than by holding a timer. A restart resumes rather than silently
 * stopping (§5.7). When there is nobody left to ask, it is cleared instead of
 * being pushed forward forever.
 */
export async function sendWave(
  ctx: BotContext,
  botRequestId: string,
): Promise<WaveResult | undefined> {
  const now = ctx.clock.now();

  const [request] = await ctx.db
    .select()
    .from(botRequests)
    .where(eq(botRequests.id, botRequestId));

  if (!request) return undefined;
  if (request.status !== 'open') return undefined;

  const snapshot = request.hospitalSnapshot as HospitalSnapshot & {
    districtId?: string | null;
    cityId?: string | null;
  };

  const donorsToAsk = await selectWave(
    ctx,
    botRequestId,
    request.bloodGroup as BloodGroup,
    {
      districtId: snapshot.districtId ?? null,
      cityId: snapshot.cityId ?? null,
      townId: null,
      localityId: null,
    },
    ctx.config.wave.size,
  );

  const waveNo = request.waveNo + 1;
  const maxWaves = ctx.config.wave.maxWaves;
  // `null` is the spec's default: waves continue until the demand closes.
  const moreWavesAllowed = maxWaves === null || waveNo < maxWaves;

  return ctx.db.transaction(async (tx) => {
    /**
     * Claim the wave with a conditional UPDATE on `wave_no` (§7.4).
     *
     * Two tickers polling the same due request would otherwise both select and
     * both notify. The second matches nothing here and stops before a single
     * message is queued.
     */
    const claimed = await tx
      .update(botRequests)
      .set({
        waveNo,
        nextWaveAt:
          donorsToAsk.length > 0 && moreWavesAllowed
            ? new Date(now.getTime() + ctx.config.wave.intervalMinutes * 60_000)
            : null,
      })
      .where(and(eq(botRequests.id, botRequestId), eq(botRequests.waveNo, request.waveNo)))
      .returning({ nextWaveAt: botRequests.nextWaveAt });

    if (claimed.length === 0) return undefined;

    if (donorsToAsk.length === 0) {
      // Nobody left to ask. The request stays open until it is filled, closed
      // by the centre, or expires. A demand that quietly stopped recruiting is
      // still a demand somebody is waiting on.
      return { waveNo, notified: 0, nextWaveAt: claimed[0]?.nextWaveAt ?? null };
    }

    const messages: QueuedMessage[] = [];

    for (const donor of donorsToAsk) {
      const journeyId = ctx.ids.next<'JourneyId'>();

      await tx.insert(donorRequests).values({
        id: journeyId,
        botRequestId,
        donorId: donor.donorId,
        status: 'NOTIFIED',
        waveNo,
        notifiedAt: now,
      });

      messages.push({
        to: { channel: donor.channel, channelUserId: donor.channelUserId },
        kind: 'request_card',
        message: {
          text: MESSAGES.request(request.bloodGroup, request.neededBy, snapshot),
          choices: [
            { label: 'Yes, I can give', data: `accept:${journeyId}` },
            { label: 'Not this time', data: `decline:${journeyId}` },
          ],
        },
        dedupeKey: `request_card:${botRequestId}:${donor.donorId}`,
      });
    }

    const queued = await enqueue(tx, ctx.ids, messages, now);

    const event = createEventWriter(tx, ctx.correlationId, now);
    await event({
      event: 'wave.sent',
      subjectType: 'bot_request',
      subjectId: botRequestId,
      metadata: {
        waveNo,
        // Ids, never names (§11.9).
        donorIds: donorsToAsk.map((donor) => donor.donorId),
        queued,
      },
    });

    return { waveNo, notified: donorsToAsk.length, nextWaveAt: claimed[0]?.nextWaveAt ?? null };
  });
}

/** Requests due a wave. The ticker's poll. A column, not a timer (§5.7). */
export async function findRequestsDueAWave(
  ctx: BotContext,
  limit = 10,
): Promise<{ id: string }[]> {
  const now = ctx.clock.now();

  return ctx.db
    .select({ id: botRequests.id })
    .from(botRequests)
    // `lte`, not a `sql` template with a Date in it: the driver cannot bind a
    // JavaScript Date interpolated into raw SQL, and the failure is a runtime
    // type error rather than anything a typecheck catches.
    .where(and(eq(botRequests.status, 'open'), lte(botRequests.nextWaveAt, now)))
    .orderBy(botRequests.nextWaveAt)
    .limit(limit);
}
