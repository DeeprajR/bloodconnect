/**
 * The Telegram adapter (§2.11, §10).
 *
 * The **only** file in this package that knows Telegram exists. Everything above
 * it speaks the channel port's vocabulary, an address, a message, some choices
 *, which is what makes adding WhatsApp later an adapter rather than a rewrite.
 *
 * **Long polling, not webhooks.** No public URL, no TLS certificate, no tunnel:
 * the bot runs from a laptop behind a hospital's network, which is the
 * deployment this system actually has (§10).
 *
 * Two failure distinctions this adapter is responsible for making, because
 * nothing above it can:
 *
 *  - **403 is permanent.** The person blocked the bot. The outbox abandons it
 *    rather than retrying forever and burying the messages that could still be
 *    delivered.
 *  - **429 carries `retry_after`.** Telegram is asking to be left alone, and
 *    ignoring it is how an account gets limited harder.
 */

import {
  INERT_CHOICE,
  type ChannelAddress,
  type ChannelPort,
  type Choice,
  type IncomingUpdate,
  type OutgoingMessage,
  type SendResult,
} from '../ports/channel.js';

export const TELEGRAM_CHANNEL = 'telegram';

type TelegramResponse<T> = {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
};

type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number };
    chat: { id: number };
    text?: string;
    contact?: { phone_number?: string; user_id?: number };
  };
  callback_query?: {
    id: string;
    from: { id: number };
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
};

export type TelegramOptions = {
  readonly token: string;
  readonly apiBase?: string;
  /** Seconds the long poll waits before returning empty. */
  readonly pollTimeoutSeconds?: number;
  readonly fetchImpl?: typeof fetch;
};

/**
 * What the blue Menu button offers (§5, §8).
 *
 * Telegram keeps this list against the bot account rather than against a
 * message, so it is the one part of the interface that is there before anybody
 * has said anything, and it survives clearing the chat. Without it a first-time
 * visitor faces a text box and has to guess that words like "needs" do
 * something.
 *
 * Every entry is a word the router already understands, arriving as `/needs`
 * and handled in the same branch as somebody typing it. The menu adds
 * discoverability and no behaviour, which is what keeps this an adapter concern
 * rather than a second way through the system.
 *
 * The descriptions are what the command does for the person, because Telegram
 * shows them in the list underneath each command.
 */
const COMMANDS: readonly { command: string; description: string }[] = [
  { command: 'needs', description: 'What is needed near you right now' },
  { command: 'donate', description: 'Tell us you would like to give' },
  { command: 'profile', description: 'Check or change your details' },
  { command: 'pause', description: 'Stop being asked for a while' },
  { command: 'resume', description: 'Start being asked again' },
  { command: 'help', description: 'What you can say' },
  { command: 'stop', description: 'Stop being contacted at all' },
];

/**
 * Chat platforms allow at most a handful of buttons per row. Three is what fits
 * on a phone without wrapping into something unreadable at arm's length in a
 * corridor.
 */
const BUTTONS_PER_ROW = 3;

/**
 * One button, in whichever of the three states it is in.
 *
 * **Telegram has no disabled button.** The API offers no such flag, so the two
 * halves of "deactivated" are done separately: the label says so, and the
 * callback data is replaced with an inert marker the router ignores. Both are
 * needed. The label alone leaves a live button behind a greyed-out word, and
 * the data alone leaves a button that looks answerable and silently is not.
 *
 * The marks are a tick for the answer given and a middle dot for the rest.
 * Deliberately not colour, which a button label cannot carry anyway, and
 * deliberately not removing the other options: somebody scrolling back should
 * be able to see what they were asked as well as what they said.
 */
function button(choice: Choice): { text: string; callback_data: string } {
  const label =
    choice.state === 'chosen'
      ? `\u2705 ${choice.label}`
      : choice.state === 'unavailable'
        ? `\u00b7 ${choice.label}`
        : choice.label;

  return {
    text: label,
    // Telegram caps callback data at 64 bytes. The ids are UUIDs with a short
    // verb, which fits, but truncating silently would produce a callback that
    // matches no journey, so it is sliced deliberately rather than by accident.
    callback_data: (choice.state === 'unavailable' ? INERT_CHOICE : choice.data).slice(0, 64),
  };
}

export function createTelegramChannel(options: TelegramOptions): ChannelPort {
  const {
    token,
    apiBase = 'https://api.telegram.org',
    pollTimeoutSeconds = 30,
    fetchImpl = fetch,
  } = options;

  if (!token || token === 'replace-me') {
    // Fail at construction, not at the first message. A bot that starts and
    // then silently cannot send is worse than one that refuses to start (§13).
    throw new Error(
      'TELEGRAM_BOT_TOKEN is not set. Get one from @BotFather, or run with ' +
        'CHANNEL=memory to use the in-memory channel.',
    );
  }

  const endpoint = (method: string): string => `${apiBase}/bot${token}/${method}`;

  /** Highest update id seen, plus one. Telegram's own cursor. */
  let offset = 0;

  async function call<T>(
    method: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<TelegramResponse<T>> {
    const response = await fetchImpl(endpoint(method), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });

    return (await response.json()) as TelegramResponse<T>;
  }

  const keyboard = (message: OutgoingMessage): Record<string, unknown> | undefined => {
    /**
     * A contact request is a **reply** keyboard, not an inline one.
     *
     * Telegram only offers `request_contact` on the keyboard that replaces the
     * user's own input area, so this cannot be combined with inline choices,
     * and the flow above is written so it never needs to be: step 1 offers the
     * tap and accepts a typed number in the same breath.
     */
    if (message.requestContact === true) {
      return {
        keyboard: [[{ text: 'Share my number', request_contact: true }]],
        one_time_keyboard: true,
        resize_keyboard: true,
      };
    }

    if (!message.choices || message.choices.length === 0) {
      // Clears a contact keyboard left over from step 1, so the button does not
      // sit under every later message inviting a second tap.
      return { remove_keyboard: true };
    }

    const rows: { text: string; callback_data: string }[][] = [];
    for (let i = 0; i < message.choices.length; i += BUTTONS_PER_ROW) {
      rows.push(message.choices.slice(i, i + BUTTONS_PER_ROW).map(button));
    }
    return { inline_keyboard: rows };
  };

  return {
    name: TELEGRAM_CHANNEL,

    async send(to: ChannelAddress, message: OutgoingMessage): Promise<SendResult> {
      const markup = keyboard(message);

      /**
       * Three shapes, and which one is used is decided here rather than by the
       * caller: a fresh message, a full edit, or an edit of the buttons alone.
       *
       * The last is what locking an answered question uses. `editMessageText`
       * would work too, but it would re-send text already on the person's
       * screen, and Telegram refuses an edit whose text is unchanged, so a
       * question locked without altering a word would fail every time.
       */
      const editingButtonsOnly = message.editChoicesOnly === true && Boolean(message.replaces);
      const method = editingButtonsOnly
        ? 'editMessageReplyMarkup'
        : message.replaces
          ? 'editMessageText'
          : 'sendMessage';

      try {
        const response = await call<{ message_id: number }>(method, {
          chat_id: to.channelUserId,
          ...(editingButtonsOnly ? {} : { text: message.text }),
          ...(message.replaces ? { message_id: Number(message.replaces) } : {}),
          ...(markup ? { reply_markup: markup } : {}),
        });

        if (response.ok && response.result) {
          return { ok: true, messageRef: String(response.result.message_id) };
        }

        const code = response.error_code ?? 0;
        // 403: blocked or deactivated. 400: a malformed request that will be
        // malformed again next time. Neither is worth retrying.
        const permanent = code === 403 || code === 400;

        return {
          ok: false,
          permanent,
          reason: `telegram ${String(code)}: ${response.description ?? 'unknown error'}`,
        };
      } catch (error) {
        // A network failure is temporary by definition. The outbox retries it.
        return {
          ok: false,
          permanent: false,
          reason: error instanceof Error ? error.message : 'network error',
        };
      }
    },

    async receive(signal?: AbortSignal): Promise<readonly IncomingUpdate[]> {
      const response = await call<TelegramUpdate[]>(
        'getUpdates',
        { offset, timeout: pollTimeoutSeconds, allowed_updates: ['message', 'callback_query'] },
        signal,
      );

      if (!response.ok || !response.result) return [];

      const updates: IncomingUpdate[] = [];

      for (const update of response.result) {
        // Advance the cursor for every update, including ones this bot does not
        // handle. Leaving one unacknowledged makes Telegram redeliver it
        // forever and the poll never progresses.
        offset = Math.max(offset, update.update_id + 1);

        if (update.callback_query?.data && update.callback_query.message) {
          updates.push({
            kind: 'choice',
            address: {
              channel: TELEGRAM_CHANNEL,
              channelUserId: String(update.callback_query.message.chat.id),
            },
            data: update.callback_query.data,
            messageRef: String(update.callback_query.message.message_id),
            updateId: String(update.update_id),
          });
          // Telegram shows a spinner on the button until this is answered.
          await call('answerCallbackQuery', { callback_query_id: update.callback_query.id });
          continue;
        }

        // A shared contact: the number arrives vouched for by the platform.
        if (update.message?.contact?.phone_number) {
          updates.push({
            kind: 'contact',
            address: {
              channel: TELEGRAM_CHANNEL,
              channelUserId: String(update.message.chat.id),
            },
            phone: update.message.contact.phone_number,
            updateId: String(update.update_id),
          });
          continue;
        }

        if (update.message?.text) {
          updates.push({
            kind: 'text',
            address: {
              channel: TELEGRAM_CHANNEL,
              channelUserId: String(update.message.chat.id),
            },
            text: update.message.text,
            updateId: String(update.update_id),
          });
        }
      }

      return updates;
    },

    async check(): Promise<{ ok: boolean; detail: string }> {
      try {
        // `getMe` verifies the token and that the platform is reachable. A
        // real check, not a process-liveness ping (§11.9).
        const response = await call<{ username?: string }>('getMe', {});

        /**
         * Publish the menu on the way past, and never fail the check for it.
         *
         * `setMyCommands` is idempotent and cheap, so the health check is the
         * natural place: it runs at boot, and re-running it after a restart is
         * how the list gets corrected if it was ever edited by hand. A bot that
         * refused to start because its menu could not be published would be
         * trading a working recruitment loop for a cosmetic one.
         */
        if (response.ok) {
          await call('setMyCommands', { commands: COMMANDS });
        }

        return response.ok
          ? { ok: true, detail: `connected as @${response.result?.username ?? 'unknown'}` }
          : { ok: false, detail: response.description ?? 'getMe failed' };
      } catch (error) {
        return {
          ok: false,
          detail: error instanceof Error ? error.message : 'unreachable',
        };
      }
    },
  };
}
