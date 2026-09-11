/**
 * The messaging channel, as a port (§2.11).
 *
 * §2.11 is unambiguous: the channel is swappable, and "no Telegram type appears
 * above the adapter". So this file defines conversation in terms the domain
 * already has, a person to reach, a message, some choices, and the adapter
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
 * everything needed to identify the action, because a callback can arrive after
 * a restart, from a card posted days ago.
 *
 * `state` is how an answered question stops being answerable (§8):
 *
 *  - `chosen` marks the one the person picked.
 *  - `unavailable` is every other option on a question already answered. It
 *    stays visible, because a question whose alternatives vanish leaves nobody
 *    able to check what they were asked, but tapping it does nothing.
 *
 * Kept as a hint rather than a rendered string so each adapter can express it
 * the way its platform allows. Nothing above the adapter knows what a disabled
 * button looks like.
 */
export type ChoiceState = 'chosen' | 'unavailable';

export type Choice = {
  readonly label: string;
  readonly data: string;
  readonly state?: ChoiceState | undefined;
};

/**
 * The callback data an already-answered option sends.
 *
 * A platform with no way to disable a button still delivers the tap, so it has
 * to arrive as something the router recognises and deliberately ignores.
 * Answering it with the standing message would be worse than doing nothing: the
 * person tapped a greyed-out option and would get a wall of unrelated text.
 */
export const INERT_CHOICE = 'answered';

export type OutgoingMessage = {
  readonly text: string;
  readonly choices?: readonly Choice[];
  /**
   * Ask the platform for the person's own phone number (§5, step 1).
   *
   * The donor taps once and the number arrives **verified by the platform**,
   * which is the difference between a number the counter can ring and a string
   * somebody typed. An adapter whose platform cannot do this simply ignores the
   * flag, and the flow falls back to asking them to type it; that fallback is
   * the reason this is a hint rather than a separate port operation.
   */
  readonly requestContact?: boolean;
  /**
   * Where the platform allows editing in place, the reference returned by an
   * earlier send. Editing a card beats posting a fourth copy of it.
   */
  readonly replaces?: string | undefined;
  /**
   * Edit only the buttons of `replaces`, leaving its text exactly as it was.
   *
   * What locking an answered question needs: the question itself is already on
   * the person's screen and correct, and re-sending the text would either
   * reflow their chat or risk saying it slightly differently. Only the buttons
   * change, from answerable to answered.
   *
   * Ignored by an adapter whose platform cannot edit a message. The worst case
   * is the old buttons staying live, and every handler behind them already
   * refuses a second answer, so nothing is corrupted by it.
   */
  readonly editChoicesOnly?: boolean | undefined;
};

export type SendResult =
  | { readonly ok: true; readonly messageRef: string }
  /**
   * `permanent` distinguishes "try again in a minute" from "this person has
   * blocked the bot". The outbox retries the first and abandons the second.
   * Retrying a block forever is how a queue fills up with messages that can
   * never be delivered.
   */
  | { readonly ok: false; readonly permanent: boolean; readonly reason: string };

/** What arrives from a person: a typed message, a tap on a choice, or a shared contact. */
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
    }
  /**
   * The person tapped "share my number". The platform vouches for it, so this
   * is the one path that produces a **verified** phone (§5).
   */
  | {
      readonly kind: 'contact';
      readonly address: ChannelAddress;
      readonly phone: string;
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
  /** Verifies the platform is actually reachable. A health check, not a ping. */
  readonly check: () => Promise<{ ok: boolean; detail: string }>;
};

/**
 * The channels this process can actually reach.
 *
 * §2.11 stores a channel **per donor** and **per queued message**, because one
 * person may be reachable on Telegram today and WhatsApp tomorrow, and both
 * kinds of row can be in the outbox at once. So delivery is a lookup, not a
 * single adapter: sending a message queued for one platform through another
 * delivers it to a stranger, or to nobody.
 *
 * `default` is the channel new conversations arrive on. The one being polled.
 */
export type ChannelRegistry = {
  readonly default: ChannelPort;
  readonly for: (name: string) => ChannelPort | undefined;
  readonly names: readonly string[];
};

export function createChannelRegistry(
  primary: ChannelPort,
  ...others: readonly ChannelPort[]
): ChannelRegistry {
  const ports = new Map<string, ChannelPort>(
    [primary, ...others].map((port) => [port.name, port]),
  );

  return {
    default: primary,
    for: (name) => ports.get(name),
    names: [...ports.keys()],
  };
}
