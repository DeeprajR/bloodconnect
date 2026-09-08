/**
 * The email port and its templates (§2.4, §10).
 *
 * The provider sits behind this interface so it can be swapped without touching
 * a use case, and so the demonstration runs against a local mail catcher rather
 * than a verified sending domain.
 *
 * **A use case never calls this.** It writes a row to `email_deliveries` in the
 * same transaction as the thing that caused it, and a separate drain sends it.
 * That ordering is the point: an account created whose invite was never queued
 * is an account nobody can ever sign in to, and the person is never told.
 */

import type { EmailKind } from '@blood-connect/db';

export type OutgoingEmail = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
};

export type SendResult =
  | { readonly ok: true; readonly providerMessageId: string | null }
  | { readonly ok: false; readonly retryable: boolean; readonly error: string };

export type EmailPort = {
  readonly send: (email: OutgoingEmail) => Promise<SendResult>;
};

/**
 * Bumped whenever the wording of a template changes.
 *
 * Recorded on every delivery row, so "what did we actually send that person"
 * is answerable a year later — which matters most for the messages that carry
 * a consequence, like an address change.
 */
export const TEMPLATE_VERSION = '1';

export type TemplateVars = Readonly<Record<string, string>>;

/**
 * Templates are plain text.
 *
 * Not a stylistic preference: these are transactional messages carrying a link
 * or a code, they must survive a text-only client, and HTML mail is the single
 * biggest reason a legitimate message lands in spam. The spec asks for plain
 * language for donors (§2.7); the same applies to staff.
 */
const TEMPLATES: Readonly<
  Record<EmailKind, (vars: TemplateVars) => { subject: string; text: string }>
> = {
  invite: (v) => ({
    subject: 'Set up your Blood Connect account',
    text: [
      `Hello ${v['fullName'] ?? 'there'},`,
      '',
      'An account has been created for you on Blood Connect.',
      'Open the link below to choose a password. It signs you in straight away.',
      '',
      v['link'] ?? '',
      '',
      `The link works once, and expires in ${v['expiresInHours'] ?? '48'} hours.`,
      'If it has expired, ask your administrator to send another.',
      '',
      'If you were not expecting this, ignore it and tell your administrator.',
    ].join('\n'),
  }),

  invite_resent: (v) => ({
    subject: 'Your Blood Connect sign-up link',
    text: [
      `Hello ${v['fullName'] ?? 'there'},`,
      '',
      'Here is a new link to set up your Blood Connect account.',
      '',
      v['link'] ?? '',
      '',
      'This replaces any earlier link, which no longer works.',
      `It expires in ${v['expiresInHours'] ?? '48'} hours.`,
    ].join('\n'),
  }),

  password_otp: (v) => ({
    subject: 'Your Blood Connect reset code',
    text: [
      'Someone asked to reset the password on this Blood Connect account.',
      '',
      `Your code is ${v['otp'] ?? ''}`,
      '',
      `It expires in ${v['expiresInMinutes'] ?? '10'} minutes and can be used once.`,
      '',
      'If this was not you, no action is needed — your password has not changed.',
    ].join('\n'),
  }),

  password_changed: () => ({
    subject: 'Your Blood Connect password was changed',
    text: [
      'The password on your Blood Connect account has just been changed,',
      'and every signed-in session has been ended.',
      '',
      'If this was you, there is nothing to do.',
      '',
      'If it was not, contact your administrator immediately.',
    ].join('\n'),
  }),

  email_change_confirm: (v) => ({
    subject: 'Confirm your new Blood Connect address',
    text: [
      `Hello ${v['fullName'] ?? 'there'},`,
      '',
      'You asked to change the address on your Blood Connect account to this one.',
      'Open the link below to confirm it.',
      '',
      v['link'] ?? '',
      '',
      `The link works once and expires in ${v['expiresInHours'] ?? '24'} hours.`,
      'Until you confirm, your account keeps its current address.',
      '',
      'If you did not ask for this, ignore this message.',
    ].join('\n'),
  }),

  // Goes to the OLD address. Someone losing control of an account must hear
  // about it at the address they still read (§3).
  email_change_notice: (v) => ({
    subject: 'The address on your Blood Connect account is being changed',
    text: [
      `Hello ${v['fullName'] ?? 'there'},`,
      '',
      `A request was made to change this account's address to ${v['newEmail'] ?? 'a new address'}.`,
      'It takes effect only when that address confirms it.',
      '',
      'If you did not ask for this, contact your administrator now —',
      'someone else may have access to your account.',
    ].join('\n'),
  }),

  account_deactivated: (v) => ({
    subject: 'Your Blood Connect account has been deactivated',
    text: [
      `Hello ${v['fullName'] ?? 'there'},`,
      '',
      'Your Blood Connect account has been deactivated and you have been signed out.',
      '',
      'If you think this is a mistake, contact your administrator.',
    ].join('\n'),
  }),
};

export function renderEmail(
  kind: EmailKind,
  to: string,
  vars: TemplateVars,
): OutgoingEmail {
  const { subject, text } = TEMPLATES[kind](vars);
  return { to, subject, text };
}
