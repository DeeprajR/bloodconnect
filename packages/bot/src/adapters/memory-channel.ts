/**
 * An in-memory channel (§10, §17).
 *
 * Not a convenience for tests. It is what makes the stand-down guarantee of
 * §7.6 **provable** rather than asserted. The whole loop runs against it with no
 * network, no token and no external account, which is also the degraded mode
 * §10 asks for: the system must be demonstrable when the chat platform is not
 * reachable.
 *
 * It can be told to fail, permanently or temporarily, because the outbox's
 * retry and abandon behaviour is the half that never gets exercised by a happy
 * path and therefore never fails until it matters.
 */

import type {
  ChannelAddress,
  ChannelPort,
  IncomingUpdate,
  OutgoingMessage,
  SendResult,
} from '../ports/channel.js';

export type SentMessage = {
  readonly to: ChannelAddress;
  readonly message: OutgoingMessage;
  readonly messageRef: string;
};

export type MemoryChannel = ChannelPort & {
  /** Everything sent, in order. */
  readonly sent: readonly SentMessage[];
  /** Queue an update as though a person had sent it. */
  readonly push: (update: IncomingUpdate) => void;
  /** Make the next `n` sends fail. `permanent` is a block, not an outage. */
  readonly failNext: (count: number, permanent?: boolean) => void;
  readonly clear: () => void;
  /** Everything sent to one person, for a test that reads like a transcript. */
  readonly to: (channelUserId: string) => readonly OutgoingMessage[];
};

export function createMemoryChannel(name = 'memory'): MemoryChannel {
  const sent: SentMessage[] = [];
  const inbox: IncomingUpdate[] = [];
  let failures = 0;
  let failPermanently = false;
  let counter = 0;

  return {
    name,
    sent,

    // The port is async because a real channel is; this one has nothing to
    // wait for, so it returns a resolved promise rather than pretending.
    send(to: ChannelAddress, message: OutgoingMessage): Promise<SendResult> {
      if (failures > 0) {
        failures -= 1;
        return Promise.resolve({
          ok: false,
          permanent: failPermanently,
          reason: failPermanently ? 'blocked by the recipient' : 'temporary failure',
        });
      }

      counter += 1;
      const messageRef = `${name}-${String(counter)}`;
      sent.push({ to, message, messageRef });
      return Promise.resolve({ ok: true, messageRef });
    },

    receive(): Promise<readonly IncomingUpdate[]> {
      const batch = [...inbox];
      inbox.length = 0;
      return Promise.resolve(batch);
    },

    check(): Promise<{ ok: boolean; detail: string }> {
      return Promise.resolve({ ok: true, detail: 'in-memory channel, always reachable' });
    },

    push(update: IncomingUpdate): void {
      inbox.push(update);
    },

    failNext(count: number, permanent = false): void {
      failures = count;
      failPermanently = permanent;
    },

    clear(): void {
      sent.length = 0;
      inbox.length = 0;
      failures = 0;
      failPermanently = false;
    },

    to(channelUserId: string): readonly OutgoingMessage[] {
      return sent
        .filter((entry) => entry.to.channelUserId === channelUserId)
        .map((entry) => entry.message);
    },
  };
}
