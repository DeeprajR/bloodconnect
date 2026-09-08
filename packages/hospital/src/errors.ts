/**
 * Module 1's error taxonomy (§11.4). Expected failures are values.
 */

export { notAuthorized, type NotAuthorized } from '@blood-connect/platform';

import type { NotAuthorized } from '@blood-connect/platform';

export type PatientNotFound = { readonly kind: 'PatientNotFound'; readonly message: string };
export type AdmissionNotFound = {
  readonly kind: 'AdmissionNotFound';
  readonly message: string;
};
export type RequestNotFound = { readonly kind: 'RequestNotFound'; readonly message: string };

/**
 * The draft endpoints refuse anything already submitted (§8.2).
 *
 * Carries the status it actually found, because "you cannot edit this" is much
 * less useful than "this was submitted" — one of them tells the doctor what to
 * do next.
 */
export type RequestNotADraft = {
  readonly kind: 'RequestNotADraft';
  readonly status: string;
  readonly message: string;
};

export type IncompleteDraft = {
  readonly kind: 'IncompleteDraft';
  readonly missing: readonly string[];
  readonly message: string;
};

export type InvalidPatient = {
  readonly kind: 'InvalidPatient';
  readonly reason: string;
  readonly message: string;
};

export type IpNumberTaken = { readonly kind: 'IpNumberTaken'; readonly message: string };

export type SubmitError =
  | NotAuthorized
  | RequestNotFound
  | RequestNotADraft
  | IncompleteDraft;

export type DraftError = NotAuthorized | RequestNotFound | RequestNotADraft | AdmissionNotFound;

export const patientNotFound = (): PatientNotFound => ({
  kind: 'PatientNotFound',
  message: 'That patient record no longer exists.',
});

export const admissionNotFound = (): AdmissionNotFound => ({
  kind: 'AdmissionNotFound',
  message: 'That admission no longer exists.',
});

export const requestNotFound = (): RequestNotFound => ({
  kind: 'RequestNotFound',
  message: 'That request no longer exists.',
});

export const requestNotADraft = (status: string): RequestNotADraft => ({
  kind: 'RequestNotADraft',
  status,
  message:
    status === 'cancelled'
      ? 'This request was cancelled and can no longer be edited.'
      : 'This request has already been submitted and can no longer be edited.',
});

export const incompleteDraft = (missing: readonly string[]): IncompleteDraft => ({
  kind: 'IncompleteDraft',
  missing,
  message: 'Some required details are missing. Go back and complete the form.',
});

export const invalidPatient = (reason: string): InvalidPatient => ({
  kind: 'InvalidPatient',
  reason,
  message: reason,
});

export const ipNumberTaken = (): IpNumberTaken => ({
  kind: 'IpNumberTaken',
  message: 'An admission with that IP number already exists.',
});
