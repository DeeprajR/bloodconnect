/**
 * Module 2's error taxonomy (§11.4). Expected failures are values, not throws.
 *
 * Two of these carry more than a message, because the screen has to say
 * something specific:
 *
 *  - `RequestAlreadyDecided` is what the loser of a decision race gets. It is
 *    an ordinary outcome of two people working the same queue, not a fault.
 *  - `TagUnavailable` names which of §4's three collision cases was hit, so the
 *    screen can say what actually happened rather than "tag in use".
 */

export { notAuthorized, type NotAuthorized } from '@blood-connect/platform';

import type { NotAuthorized } from '@blood-connect/platform';

export type RequestNotFound = { readonly kind: 'RequestNotFound'; readonly message: string };

export type RequestNotDecidable = {
  readonly kind: 'RequestNotDecidable';
  readonly status: string;
  readonly message: string;
};

/**
 * The unique constraint on `centre_decisions.request_id` fired (§7.2).
 *
 * The second transaction lost the race. Nothing it attempted was written — the
 * bags it had claimed were released when it rolled back — so the honest thing
 * to say is that the request already has an answer, and to show it.
 */
export type RequestAlreadyDecided = {
  readonly kind: 'RequestAlreadyDecided';
  readonly message: string;
};

export type NotEnoughStock = {
  readonly kind: 'NotEnoughStock';
  readonly available: number;
  readonly requested: number;
  readonly message: string;
};

export type InvalidBag = {
  readonly kind: 'InvalidBag';
  readonly reason: string;
  readonly message: string;
};

export type UnitNumberTaken = {
  readonly kind: 'UnitNumberTaken';
  readonly message: string;
};

/** Which of §4's three cases a presented tag turned out to be. */
export type TagCase = 'bag_live' | 'bag_terminal' | 'register_conflict' | 'retired';

export type TagUnavailable = {
  readonly kind: 'TagUnavailable';
  readonly case: TagCase;
  readonly message: string;
};

export type SettingsIncomplete = {
  readonly kind: 'SettingsIncomplete';
  readonly missing: readonly string[];
  readonly message: string;
};

export type DemandNotFound = { readonly kind: 'DemandNotFound'; readonly message: string };

export type DecideError =
  | NotAuthorized
  | RequestNotFound
  | RequestNotDecidable
  | RequestAlreadyDecided
  | SettingsIncomplete;

export type RegisterBagError =
  | NotAuthorized
  | InvalidBag
  | UnitNumberTaken
  | TagUnavailable;

export const requestNotFound = (): RequestNotFound => ({
  kind: 'RequestNotFound',
  message: 'That request no longer exists.',
});

export const requestNotDecidable = (status: string): RequestNotDecidable => ({
  kind: 'RequestNotDecidable',
  status,
  message:
    status === 'cancelled'
      ? 'The doctor cancelled this request. There is nothing to answer.'
      : status === 'draft'
        ? 'This request has not been submitted yet.'
        : 'This request has already been answered.',
});

export const requestAlreadyDecided = (): RequestAlreadyDecided => ({
  kind: 'RequestAlreadyDecided',
  message:
    'Somebody answered this request a moment ago. Nothing you entered was saved — ' +
    'reload to see the answer that was recorded.',
});

export const notEnoughStock = (available: number, requested: number): NotEnoughStock => ({
  kind: 'NotEnoughStock',
  available,
  requested,
  message: `Only ${available} of the ${requested} units requested are on the shelf.`,
});

export const invalidBag = (reason: string): InvalidBag => ({
  kind: 'InvalidBag',
  reason,
  message: reason,
});

export const unitNumberTaken = (): UnitNumberTaken => ({
  kind: 'UnitNumberTaken',
  message: 'A bag with that unit number is already registered.',
});

/**
 * The three cases of §4, and the fourth that is simply a dead tag.
 *
 * `register_conflict` is case 3, and it deliberately offers no resolution here:
 * the register believes this bag is on the shelf right now, which means either
 * the register is stale, two bags carry the same tag, or the tag is cloned.
 * Every one of those can put the wrong unit into a patient. The pressure to add
 * a "use it anyway" button will come from busy staff, and the answer is no.
 */
export const tagUnavailable = (kind: TagCase): TagUnavailable => ({
  kind: 'TagUnavailable',
  case: kind,
  message:
    kind === 'retired'
      ? 'That tag was retired and can never carry a bag again. Use a fresh tag.'
      : kind === 'register_conflict'
        ? 'The register says the bag on this tag is on the shelf right now. ' +
          'Do not register anything on it. Find that bag physically first — the ' +
          'discrepancy workflow arrives in a later phase.'
        : kind === 'bag_terminal'
          ? 'This tag is still assigned to a finished bag. It has to be released ' +
            'before it can carry a new one — that flow arrives in a later phase.'
          : 'This tag is assigned to a bag that is issued or reserved. If the unit ' +
            'has come back, it is a return, not a new registration.',
});

export const settingsIncomplete = (missing: readonly string[]): SettingsIncomplete => ({
  kind: 'SettingsIncomplete',
  missing,
  message:
    'The centre settings are incomplete, so donors cannot be told where to come. ' +
    `Set ${missing.join(' and ')} on the settings screen first.`,
});

export const demandNotFound = (): DemandNotFound => ({
  kind: 'DemandNotFound',
  message: 'That demand no longer exists.',
});
