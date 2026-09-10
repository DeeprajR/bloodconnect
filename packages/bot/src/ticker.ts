/**
 * The bot ticker (§11.2).
 *
 * One pass over everything that is due, in an order chosen so the loop closes in
 * a single tick where it can. It polls **columns**, never in-memory timers:
 * `next_wave_at`, the demand's status, the confirmation's `acknowledged_at`. A
 * restart resumes; nothing is held in this process that matters.
 *
 * The order below is deliberate:
 *
 *  1. **Cancellations first.** A demand the centre withdrew has donors holding
 *     places for it right now, and every tick they are not told is a tick
 *     somebody might set out for the hospital.
 *  2. New demand, so recruitment can start.
 *  3. Expiries, after the import, so a demand that arrives already past its
 *     day is closed before anybody is asked about it.
 *  4. Walk-ins, before the waves: a unit already collected at the counter is a
 *     unit nobody should be invited to give.
 *  5. Waves.
 *  6. Counter outcomes, which roll intervals forward and thank people.
 *  7. Completions, which stand down whoever is left.
 *  8. Progress written back to the centre.
 *  9. Anybody still holding a card for a request that has filled, told it is
 *     covered, after the promotions, since a freed place may still be theirs.
 * 10. One nudge for an abandoned signup. The least urgent thing here, so it
 *     never delays a stand-down.
 * 11. The outbox drain, last, so everything queued this tick goes out in it.
 */

import type { BotContext } from './context.js';
import { drainOutbox, type DrainResult } from './outbox.js';
import {
  closeDemand,
  findCancelledDemands,
  findExpiredDemands,
  tellUnansweredItIsCovered,
} from './use-cases/close-demand.js';
import { importOpenDemands, writeBackProgress } from './use-cases/import-demand.js';
import { applyCounterOutcomes, findCompletedRequests } from './use-cases/outcomes.js';
import { promoteFromWaitlist } from './use-cases/journey.js';
import { findRequestsDueAWave, sendWave } from './use-cases/waves.js';
import { applyWalkIns } from './use-cases/walk-ins.js';
import { remindAbandonedSignups } from './use-cases/reminders.js';
import { publishBotHealth } from './use-cases/publish-health.js';

export type TickResult = {
  readonly imported: number;
  readonly wavesSent: number;
  readonly donorsNotified: number;
  readonly cancelled: number;
  readonly expired: number;
  readonly completed: number;
  readonly outcomesApplied: number;
  readonly promoted: number;
  readonly walkInsCounted: number;
  readonly signupsReminded: number;
  readonly toldItIsCovered: number;
  readonly standDownsQueued: number;
  readonly drain: DrainResult;
  /** How many of the bot's own §11.9 alerts are live, for the control panel. */
  readonly alertsPublished: number;
};

export async function tick(ctx: BotContext): Promise<TickResult> {
  let cancelled = 0;
  let expired = 0;
  let completed = 0;
  let standDownsQueued = 0;
  let promoted = 0;
  const touched = new Set<string>();

  /* --- 1. what the centre withdrew ------------------------------------- */
  for (const row of await findCancelledDemands(ctx)) {
    const result = await closeDemand(ctx, row.botRequestId, 'cancelled');
    if (result.ok && result.value.closed) {
      cancelled += 1;
      standDownsQueued += result.value.standDowns;
      touched.add(row.botRequestId);
    }
  }

  /* --- 2. new demand ---------------------------------------------------- */
  const imported = await importOpenDemands(ctx);
  for (const row of imported) touched.add(row.botRequestId);

  /* --- 3. what ran out of time ------------------------------------------ */
  /**
   * **After the import, and before the waves.**
   *
   * A demand can arrive already past the day the blood was needed. Raised
   * late, or left unimported while the bot was down. Expiring before the import
   * would miss it and then wave it, asking real people to give blood for a
   * request that had already passed; expiring after the wave would ask them and
   * stand them down in the same pass. Between the two, it is imported, closed,
   * and nobody is contacted.
   */
  for (const row of await findExpiredDemands(ctx)) {
    const result = await closeDemand(ctx, row.botRequestId, 'expired');
    if (result.ok && result.value.closed) {
      expired += 1;
      standDownsQueued += result.value.standDowns;
      touched.add(row.botRequestId);
    }
  }

  /* --- 4. what the counter already collected ---------------------------- */
  /**
   * **Before the waves.**
   *
   * A walk-in that arrives between two ticks reduces what is still needed, and
   * counting it after the wave would mean a batch of real people invited for
   * blood the fridge already has.
   */
  const walkIns = await applyWalkIns(ctx);
  for (const id of walkIns.touched) touched.add(id);

  /* --- 5. waves --------------------------------------------------------- */
  let wavesSent = 0;
  let donorsNotified = 0;
  for (const row of await findRequestsDueAWave(ctx)) {
    const result = await sendWave(ctx, row.id);
    if (!result) continue;
    wavesSent += 1;
    donorsNotified += result.notified;
    touched.add(row.id);
  }

  /* --- 6. what happened at the counter ---------------------------------- */
  const outcomes = await applyCounterOutcomes(ctx);

  /* --- 7. a freed place goes to the waitlist ---------------------------- */
  // After the outcomes, because a no-show is what frees one.
  for (const id of touched) {
    const result = await promoteFromWaitlist(ctx, id);
    promoted += result.promoted;
  }

  /* --- 8. everything given ---------------------------------------------- */
  for (const row of await findCompletedRequests(ctx)) {
    const result = await closeDemand(ctx, row.botRequestId, 'completed');
    if (result.ok && result.value.closed) {
      completed += 1;
      standDownsQueued += result.value.standDowns;
      touched.add(row.botRequestId);
    }
  }

  /* --- 9. filled before they answered ------------------------------------ */
  /**
   * After the promotions, because a freed place may still be theirs. Telling
   * somebody it is covered and then promoting them would be two contradictory
   * messages in one tick.
   */
  const covered = await tellUnansweredItIsCovered(ctx);

  /* --- 10. one nudge for an abandoned signup ---------------------------- */
  /**
   * Last of the work, and deliberately after everything else: a reminder is the
   * least urgent thing this loop does, and it must never delay a stand-down.
   */
  const reminders = await remindAbandonedSignups(ctx);

  /* --- 11. tell the centre, then send ----------------------------------- */
  for (const id of touched) await writeBackProgress(ctx, id);

  const drain = await drainOutbox(ctx);

  /* --- 12. tell the other half how it went ------------------------------ */
  /*
   * Last, and after the drain, so the counts published are the counts as they
   * stand at the end of the pass rather than halfway through it. Publishing
   * before the drain would report a backlog this pass had already cleared.
   *
   * `observed_at` doubles as the liveness signal: a bot that stops stops
   * writing this row, and the panel reads a stale row as silence rather than
   * as health.
   */
  const published = await publishBotHealth(ctx);

  return {
    imported: imported.length,
    wavesSent,
    donorsNotified,
    cancelled,
    expired,
    completed,
    outcomesApplied: outcomes.processed,
    promoted,
    walkInsCounted: walkIns.updated,
    signupsReminded: reminders.reminded,
    toldItIsCovered: covered.told,
    standDownsQueued,
    drain,
    alertsPublished: published.filter((alert) => alert.count > 0).length,
  };
}
