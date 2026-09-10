/**
 * The controls a donor always has (§5, §12.1).
 *
 * "A donor must be able to pause messages, opt out, and delete their data from
 * inside the chat, in one or two taps, without contacting anyone." Each has a
 * **stated end**: snooze names the date it lifts, opt-out says how to come back,
 * deletion confirms what was removed and what was kept.
 *
 * Pause and stop are only kind if coming back is as easy as leaving, which is
 * why `resumeDonor` exists and why it is offered in the same breath as both.
 */

import { and, eq } from 'drizzle-orm';
import {
  conversationState,
  donorChannels,
  donorConsents,
  donorPhones,
  donorScreeningAnswers,
  donors,
} from '@blood-connect/db/bot';
import { donorDemandConfirmations } from '@blood-connect/db';
import type { CalendarDay, Sex } from '@blood-connect/domain';

import type { BotContext } from '../context.js';
import { createEventWriter } from '../events.js';
import type { ChannelAddress } from '../ports/channel.js';
import { durableQuestionsFor } from '../screening.js';

export async function snoozeDonor(
  ctx: BotContext,
  donorId: string,
  until: CalendarDay,
): Promise<void> {
  const now = ctx.clock.now();

  await ctx.db.transaction(async (tx) => {
    await tx.update(donors).set({ snoozeUntil: until }).where(eq(donors.id, donorId));
    const event = createEventWriter(tx, ctx.correlationId, now);
    await event({
      event: 'donor.snoozed',
      subjectType: 'donor',
      subjectId: donorId,
      metadata: { until },
    });
  });
}

/**
 * Undoes a pause or an opt-out (§5).
 *
 * Clearing `opted_out_at` also restores consent currency, which is what the wave
 * query actually reads. A donor who came back and was still never contacted
 * would have left for good the second time.
 */
export async function resumeDonor(ctx: BotContext, donorId: string): Promise<void> {
  const now = ctx.clock.now();

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(donors)
      .set({ snoozeUntil: null, optedOutAt: null, consentCurrentAt: now })
      .where(eq(donors.id, donorId));
    const event = createEventWriter(tx, ctx.correlationId, now);
    await event({ event: 'donor.resumed', subjectType: 'donor', subjectId: donorId });
  });
}

export async function optOutDonor(ctx: BotContext, donorId: string): Promise<void> {
  const now = ctx.clock.now();

  await ctx.db.transaction(async (tx) => {
    await tx.update(donors).set({ optedOutAt: now }).where(eq(donors.id, donorId));
    const event = createEventWriter(tx, ctx.correlationId, now);
    await event({ event: 'donor.opted_out', subjectType: 'donor', subjectId: donorId });
  });
}

export type ErasureResult = {
  /** Donations kept, de-identified. Told to the donor, because it is theirs. */
  readonly donationsKept: number;
};

/**
 * Erasure (§12.1).
 *
 * **The donation survives; the donor's identity does not.** A blood centre is
 * required to keep a record of every unit it collected and which donation it
 * came from, so the row and its bag identifier stay, with the name and the
 * phone number removed from it. Deleting the row outright would break the
 * traceability §4 requires and would not be lawful either.
 *
 * What goes:
 *
 *  - the name, and every free-text place they typed
 *  - every phone number, and every channel they can be reached on
 *  - the durable screening answers, which are health data (§12)
 *  - the name and number on every roster row they ever appeared on
 *  - the values snapshot on each consent, which contained both
 *
 * What stays: `donor_consents` as a dated record that consent was given and to
 * which wording, evidence for the messages already sent, and the donation
 * rows themselves.
 *
 * The roster de-identification is the part that needed a grant the bot did not
 * have (migration 0016). Before it, this reported success and left the name and
 * number sitting on every confirmation.
 */
export async function deleteDonorData(
  ctx: BotContext,
  donorId: string,
): Promise<ErasureResult> {
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    await tx
      .update(donors)
      .set({
        name: 'Deleted donor',
        districtText: null,
        cityText: null,
        townText: null,
        localityText: null,
        deletedAt: now,
        optedOutAt: now,
        consentCurrentAt: null,
      })
      .where(eq(donors.id, donorId));

    await tx.delete(donorPhones).where(eq(donorPhones.donorId, donorId));
    await tx.delete(donorChannels).where(eq(donorChannels.donorId, donorId));
    // Health data, and nothing depends on it once the donor is gone (§12).
    await tx.delete(donorScreeningAnswers).where(eq(donorScreeningAnswers.donorId, donorId));

    /**
     * The consent row stays; what it was showing does not.
     *
     * The snapshot is a copy of the summary, name, masked phone, where they
     * live, and keeping it after erasure would defeat the erasure. The dated
     * fact that consent was given, and to which wording version, is what the
     * record is for and survives on its own.
     */
    await tx
      .update(donorConsents)
      .set({ valuesSnapshot: { erasedAt: now.toISOString() } })
      .where(eq(donorConsents.donorId, donorId));

    /**
     * The roster, de-identified in place (§12.1, contract 1.3.0).
     *
     * `bag_identifier`, `donated_at` and `donated_blood_group` are untouched:
     * that is the donation record, and it is the centre's to keep.
     */
    const scrubbed = await tx
      .update(donorDemandConfirmations)
      .set({ donorName: 'Deleted donor', donorPhone: 'removed' })
      .where(eq(donorDemandConfirmations.donorId, donorId))
      .returning({ id: donorDemandConfirmations.id });

    const event = createEventWriter(tx, ctx.correlationId, now);
    await event({
      event: 'donor.deleted',
      subjectType: 'donor',
      subjectId: donorId,
      // A count, so the erasure itself is auditable without recording what was
      // erased (§11.9).
      metadata: { confirmationsDeidentified: scrubbed.length },
    });

    return { donationsKept: scrubbed.length };
  });
}

/** The donor behind a channel identity, if there is one. */
export async function findDonorByAddress(
  ctx: BotContext,
  address: ChannelAddress,
): Promise<{ donorId: string; name: string } | undefined> {
  const [row] = await ctx.db
    .select({ donorId: donors.id, name: donors.name })
    .from(donorChannels)
    .innerJoin(donors, eq(donors.id, donorChannels.donorId))
    .where(
      and(
        eq(donorChannels.channel, address.channel),
        eq(donorChannels.channelUserId, address.channelUserId),
      ),
    );

  return row;
}

/**
 * The donor's own answers, read back into an interview draft (§5).
 *
 * This is what makes the profile editor "the identical summary with the
 * identical checklist" rather than a second, lesser edit screen: the stored
 * profile becomes a draft, and every prompt and every fix path is the one
 * signup already uses.
 */
export async function draftFromProfile(
  ctx: BotContext,
  donorId: string,
): Promise<Record<string, unknown> | undefined> {
  const [donor] = await ctx.db
    .select()
    .from(donors)
    .where(eq(donors.id, donorId));

  if (!donor) return undefined;

  const [phone] = await ctx.db
    .select({ e164: donorPhones.e164, verified: donorPhones.verified })
    .from(donorPhones)
    .where(eq(donorPhones.donorId, donorId));

  const flags = await ctx.db
    .select({ questionKey: donorScreeningAnswers.questionKey })
    .from(donorScreeningAnswers)
    .where(eq(donorScreeningAnswers.donorId, donorId));

  /**
   * Only the flagging answers are stored (§2.10), so everything absent is a
   * clear answer, and the draft has to say so explicitly.
   *
   * The first version of this filled in the flags alone, and the profile editor
   * then decided the screening step had never been answered and marched the
   * donor back through it before it would save. Absence is meaningful in the
   * table and meaningless in a draft; this is where the two are reconciled.
   */
  const flagged = new Set(flags.map((flag) => flag.questionKey));
  const screening: Record<string, string> = {};
  for (const question of durableQuestionsFor(donor.sex as Sex)) {
    screening[question.key] = flagged.has(question.key)
      ? question.proceedOn === 'no'
        ? 'yes'
        : 'no'
      : question.proceedOn;
  }

  return {
    phone: phone?.e164,
    phoneVerified: phone?.verified === true,
    name: donor.name,
    dob: donor.dob,
    sex: donor.sex,
    bloodGroup: donor.bloodGroup,
    weightBand: donor.weightBand,
    screening,
    districtId: donor.districtId ?? undefined,
    cityId: donor.cityId ?? undefined,
    townId: donor.townId ?? undefined,
    localityId: donor.localityId ?? undefined,
    lastDonatedOn: donor.lastDonatedOn ?? undefined,
    neverDonated: donor.lastDonatedOn === null,
  };
}

/** Anything half-typed, dropped. Used when a donor abandons an edit. */
export async function clearConversation(
  ctx: BotContext,
  address: ChannelAddress,
): Promise<void> {
  await ctx.db
    .delete(conversationState)
    .where(
      and(
        eq(conversationState.channel, address.channel),
        eq(conversationState.channelUserId, address.channelUserId),
      ),
    );
}
