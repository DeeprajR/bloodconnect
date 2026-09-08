import nodemailer, { type Transporter } from 'nodemailer';

import type { EmailPort, OutgoingEmail, SendResult } from '../ports/email.js';

/**
 * SMTP, pointed at Mailpit in development (§10).
 *
 * Mailpit accepts anything and shows it in a web inbox at :8025, so the invite,
 * the OTP and the address-change flows can be exercised end to end without a
 * verified sending domain, SPF, DKIM or a provider account. Swapping in a real
 * provider is a different adapter behind the same port and touches no use case.
 */

let transport: Transporter | undefined;

const getTransport = (): Transporter => {
  transport ??= nodemailer.createTransport({
    host: process.env['SMTP_HOST'] ?? 'localhost',
    port: Number(process.env['SMTP_PORT'] ?? 1025),
    secure: process.env['SMTP_SECURE'] === 'true',
    // Mailpit wants no credentials; a real provider supplies both.
    auth: process.env['SMTP_USER']
      ? { user: process.env['SMTP_USER'], pass: process.env['SMTP_PASSWORD'] ?? '' }
      : undefined,
  });
  return transport;
};

/**
 * A 4xx SMTP reply is the server saying "not now" — a full mailbox, a greylist,
 * a rate limit — and is worth retrying. A 5xx is "no": a bad address or a
 * rejected message, where retrying just burns the schedule and, on a bounce,
 * damages sender reputation.
 */
function isRetryable(error: unknown): boolean {
  const code = (error as { responseCode?: number } | null)?.responseCode;
  if (typeof code === 'number') return code >= 400 && code < 500;
  // A connection refused or a timeout has no SMTP code at all, and is exactly
  // the case retrying exists for.
  return true;
}

export const smtpEmailPort: EmailPort = {
  async send(email: OutgoingEmail): Promise<SendResult> {
    try {
      const info = (await getTransport().sendMail({
        from: process.env['MAIL_FROM'] ?? 'Blood Connect <no-reply@blood-connect.local>',
        to: email.to,
        subject: email.subject,
        text: email.text,
      })) as { messageId?: string };

      return { ok: true, providerMessageId: info.messageId ?? null };
    } catch (error: unknown) {
      return {
        ok: false,
        retryable: isRetryable(error),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

/**
 * Collects messages instead of sending them. For tests, and for a demonstration
 * run where nothing should leave the machine at all.
 */
export function createMemoryEmailPort(): EmailPort & {
  readonly sent: readonly OutgoingEmail[];
} {
  const sent: OutgoingEmail[] = [];
  return {
    send(email: OutgoingEmail): Promise<SendResult> {
      sent.push(email);
      return Promise.resolve({ ok: true, providerMessageId: `memory-${sent.length}` });
    },
    get sent(): readonly OutgoingEmail[] {
      return sent;
    },
  };
}
