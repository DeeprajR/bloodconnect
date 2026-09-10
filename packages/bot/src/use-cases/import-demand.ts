/**
 * Importing open demand from the centre (§8.4, §7).
 *
 * The bot polls `hospital.donor_demand` for what is open and not yet imported,
 * creates its own request row, and writes the deep-link id back onto the demand.
 * Those two writes are one transaction, which is what makes the import
 * idempotent in the way that matters: a row is never fanned out twice, however
 * often the ticker runs or however it is restarted mid-import.
 *
 * The bot writes **only** its own columns on the demand: `bot_public_id`,
 * `imported_at` and the progress counters. It physically cannot set `units`;
 * `app_bot` holds no grant on it (§5.1).
 *
 * The hospital details are copied onto `bot_requests.hospital_snapshot` and
 * never joined back. What a donor was told must not change because the centre
 * edited its address afterwards (§2.6).
 */

import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { botRequests, donorRequests } from '@blood-connect/db/bot';
import { donorDemand } from '@blood-connect/db';

import type { BotContext } from '../context.js';
import { createEventWriter } from '../events.js';

export type ImportedRequest = {
  readonly botRequestId: string;
  readonly demandId: string;
  readonly publicId: string;
  readonly bloodGroup: string;
  readonly unitsNeeded: number;
};

/**
 * A short, human-typeable deep-link id.
 *
 * Not the demand's UUID: this goes in a URL a donor may read aloud, and it is
 * the only identifier of a request that leaves the system. Ambiguous characters
 *, O and 0, I and 1, are excluded because somebody will eventually transcribe
 * one by hand.
 *
 * **It is built from the *end* of the identifier, not the beginning.** A UUIDv7
 * starts with a millisecond timestamp, so two ids minted in the same second
 * share their leading characters; deriving from those produced a public id that
 * collided on the second import of a run. The trailing characters are the
 * random ones. Found by running the loop, not by a unit test. The first import
 * of any run looks perfect.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makePublicId(source: string): string {
  const random = source.replace(/-/g, '').slice(-16);
  const body = Array.from({ length: 6 }, (_, i) => {
    // Two hex characters per output character: 8 bits of the random tail each.
    const pair = random.slice(i * 2, i * 2 + 2);
    const value = Number.parseInt(pair, 16);
    return ALPHABET[(Number.isNaN(value) ? i : value) % ALPHABET.length];
  }).join('');
  return `BC-${body}`;
}

/**
 * Imports every demand the bot has not seen.
 *
 * Each demand gets its own transaction rather than one for the batch: a single
 * malformed row must not stop the rest of the queue being recruited for.
 */
export async function importOpenDemands(
  ctx: BotContext,
  limit = 20,
): Promise<ImportedRequest[]> {
  const pending = await ctx.db
    .select({
      id: donorDemand.id,
      bloodGroup: donorDemand.bloodGroup,
      product: donorDemand.product,
      units: donorDemand.units,
      dateRequired: donorDemand.dateRequired,
      hospitalName: donorDemand.hospitalName,
      hospitalAddress: donorDemand.hospitalAddress,
      districtId: donorDemand.districtId,
      cityId: donorDemand.cityId,
      notes: donorDemand.notes,
    })
    .from(donorDemand)
    // Exactly the poll `packages/contract` describes, and the partial index
    // `donor_demand_awaiting_import_idx` is built for it.
    .where(and(eq(donorDemand.status, 'open'), isNull(donorDemand.botPublicId)))
    .orderBy(donorDemand.createdAt)
    .limit(limit);

  const imported: ImportedRequest[] = [];

  for (const demand of pending) {
    const botRequestId = ctx.ids.next<'BotRequestId'>();
    const publicId = makePublicId(botRequestId);
    const now = ctx.clock.now();

    /**
     * One transaction per demand, and one failure does not stop the batch.
     *
     * A demand that cannot be imported, a public-id collision, a malformed row
     *, must not prevent every other open demand being recruited for. The claim
     * and the insert roll back together, so the next pass simply tries again
     * with a fresh identifier.
     */
    let result: ImportedRequest | undefined;
    try {
      result = await ctx.db.transaction(async (tx) => {
        /**
         * Claim the demand first, with a conditional UPDATE guarded on
         * `bot_public_id IS NULL` (§7.4).
         *
         * Doing it before the insert is what makes two tickers safe: the second
         * matches no row, writes nothing, and moves on, rather than both
         * creating a request and one failing on the unique index afterwards, by
         * which point donors may already have been messaged.
         */
        const claimed = await tx
          .update(donorDemand)
          .set({ botPublicId: publicId, importedAt: now })
          .where(and(eq(donorDemand.id, demand.id), isNull(donorDemand.botPublicId)))
          .returning({ id: donorDemand.id });

        if (claimed.length === 0) return undefined;

        await tx.insert(botRequests).values({
          id: botRequestId,
          demandId: demand.id,
          publicId,
          bloodGroup: demand.bloodGroup,
          product: demand.product,
          unitsNeeded: demand.units,
          neededBy: demand.dateRequired,
          // Frozen here, never joined back (§2.6).
          hospitalSnapshot: {
            hospitalName: demand.hospitalName,
            hospitalAddress: demand.hospitalAddress,
            districtId: demand.districtId,
            cityId: demand.cityId,
            notes: demand.notes,
          },
          status: 'open',
          // Due a wave immediately. The ticker polls this column rather than
          // holding a timer, so a restart resumes escalation (§5.7).
          nextWaveAt: now,
          waveNo: 0,
        });

        const event = createEventWriter(tx, ctx.correlationId, now);
        await event({
          event: 'demand.imported',
          subjectType: 'bot_request',
          subjectId: botRequestId,
          metadata: {
            demandId: demand.id,
            publicId,
            bloodGroup: demand.bloodGroup,
            unitsNeeded: demand.units,
          },
        });

        return {
          botRequestId,
          demandId: demand.id,
          publicId,
          bloodGroup: demand.bloodGroup,
          unitsNeeded: demand.units,
        };
      });
    } catch {
      // Left for the next pass. Nothing was written: the claim on the demand
      // rolled back with the insert that failed.
      continue;
    }

    if (result) imported.push(result);
  }

  return imported;
}

/**
 * Writes recruitment progress back onto the demand (§7).
 *
 * The centre reads these to show "20 notified, 2 of 3 confirmed" without ever
 * seeing a donor. Four columns, all bot-owned; a mistake here fails at the
 * database rather than corrupting the centre's view.
 */
export async function writeBackProgress(
  ctx: BotContext,
  botRequestId: string,
): Promise<void> {
  const [request] = await ctx.db
    .select({
      demandId: botRequests.demandId,
      confirmed: botRequests.confirmedCount,
      waitlisted: botRequests.waitlistedCount,
      completed: botRequests.completedCount,
    })
    .from(botRequests)
    .where(eq(botRequests.id, botRequestId));

  if (!request) return;

  const [notified] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(donorRequests)
    .where(
      and(
        eq(donorRequests.botRequestId, botRequestId),
        isNotNull(donorRequests.notifiedAt),
      ),
    );

  await ctx.db
    .update(donorDemand)
    .set({
      donorsNotified: notified?.n ?? 0,
      confirmedUnits: request.confirmed,
      waitlistedUnits: request.waitlisted,
      completedUnits: request.completed,
    })
    .where(eq(donorDemand.id, request.demandId));
}
