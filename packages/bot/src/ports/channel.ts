/**
 * The messaging channel, as a port (§2.11).
 *
 * §2.11 is unambiguous: the channel is swappable, and "no Telegram type appears
 * above the adapter". So this file defines conversation in terms the domain
 * already has — a person to reach, a message, some choices — and the adapter
 * turns that into whatever the platform wants.
 *
 * Two consequences that are the point of doing it this way:
 *
 *  - **A donor's identity is never a Telegram user id.** It is a `donor_id` with
 *    rows in `donor_channels`, so reaching the same person on WhatsApp later is
 *    a row rather than a migration.
 *  - **The whole loop is testable with no network.** The in-memory adapter is
 *    not a convenience for tests; it is what lets the stand-down guarantee of
 *    §7.6 be proven rather than asserted.
 *
 * Nothing here is async-optional: sending can fail, and the outbox exists
 * precisely because it does (§7.6).
 */

/** Where a person is reachable. The pair is unique in `donor_channels`. */
export type ChannelAddress = {
  readonly channel: string;
  readonly channelUserId: string;
};

/**
 * A tappable choice. `data` is what comes back on the callback, and it carries
 * everything needed to identify the action — because a callback can arrive after
 * a restart, from a card posted days ago.
 */
export type Choice = {
  readonly label: string;
  readonly data: string;
};

export type OutgoingMessage = {
  readonly text: string;
  readonly choices?: readonly Choice[];
  /**
   * Where the platform allows editing in place, the reference returned by an
   * earlier send. Editing a card beats posting a fourth copy of it.
   */
  readonly replaces?: string | undefined;
};

export type SendResult =
  | { readonly ok: true; readonly messageRef: string }
  /**
   * `permanent` distinguishes "try again in a minute" from "this person has
   * blocked the bot". The outbox retries the first and abandons the second —
   * retrying a block forever is how a queue fills up with messages that can
   * never be delivered.
   */
  | { readonly ok: false; readonly permanent: boolean; readonly reason: string };

/** What arrives from a person: a typed message, or a tap on a choice. */
export type IncomingUpdate =
  | {
      readonly kind: 'text';
      readonly address: ChannelAddress;
      readonly text: string;
      readonly updateId: string;
    }
  | {
      readonly kind: 'choice';
      readonly address: ChannelAddress;
      readonly data: string;
      readonly messageRef: string;
      readonly updateId: string;
    };

export type ChannelPort = {
  /** The platform's name, as stored in `donor_channels.channel`. */
  readonly name: string;
  readonly send: (to: ChannelAddress, message: OutgoingMessage) => Promise<SendResult>;
  /**
   * Long-polling: returns whatever has arrived since the last call. No public
   * URL and no webhook, which is what makes this runnable from a laptop (§10).
   */
  readonly receive: (signal?: AbortSignal) => Promise<readonly IncomingUpdate[]>;
  /** Verifies the platform is actually reachable — a health check, not a ping. */
  readonly check: () => Promise<{ ok: boolean; detail: string }>;
};
