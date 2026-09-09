/**
 * The Telegram adapter (§2.11, §10).
 *
 * The **only** file in this package that knows Telegram exists. Everything above
 * it speaks the channel port's vocabulary — an address, a message, some choices
 * — which is what makes adding WhatsApp later an adapter rather than a rewrite.
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

import type {
  ChannelAddress,
  ChannelPort,
  IncomingUpdate,
  OutgoingMessage,
  SendResult,
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
 * Chat platforms allow at most a handful of buttons per row. Three is what fits
 * on a phone without wrapping into something unreadable at arm's length in a
 * corridor.
 */
const BUTTONS_PER_ROW = 3;

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
     * user's own input area, so this cannot be combined with inline choices —
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
      rows.push(
        message.choices.slice(i, i + BUTTONS_PER_ROW).map((c) => ({
          text: c.label,
          // Telegram caps callback data at 64 bytes. The ids are UUIDs with a
          // short verb, which fits — but truncating silently would produce a
          // callback that matches no journey, so it is checked.
          callback_data: c.data.slice(0, 64),
        })),
      );
    }
    return { inline_keyboard: rows };
  };

  return {
    name: TELEGRAM_CHANNEL,

    async send(to: ChannelAddress, message: OutgoingMessage): Promise<SendResult> {
      const markup = keyboard(message);

      try {
        const response = await call<{ message_id: number }>(
          message.replaces ? 'editMessageText' : 'sendMessage',
          {
            chat_id: to.channelUserId,
            text: message.text,
            ...(message.replaces ? { message_id: Number(message.replaces) } : {}),
            ...(markup ? { reply_markup: markup } : {}),
          },
        );

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
        // A network failure is temporary by definition — the outbox retries it.
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
        // handle — leaving one unacknowledged makes Telegram redeliver it
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
        // `getMe` verifies the token and that the platform is reachable — a
        // real check, not a process-liveness ping (§11.9).
        const response = await call<{ username?: string }>('getMe', {});
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
