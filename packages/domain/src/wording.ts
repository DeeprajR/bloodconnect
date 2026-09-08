/**
 * The vocabulary (§2.7).
 *
 * The spec has a "use / not" table of clinical terms, and the reason it exists
 * is that the wrong word is not a style problem here. "Blood bank" is the term
 * Indian regulation replaced in 2020. "Cooldown" for an inter-donation interval
 * reads as a game mechanic. "Eliminated" for a deferral tells a donor they were
 * judged, when the truth is usually "not today".
 *
 * Every screen takes its labels from here, and a regression test pins the
 * strings — because this is exactly the kind of thing that drifts one hurried
 * commit at a time, and nobody notices until a clinician does.
 */

export const WORDING = {
  /* Module 1 — the request */
  bloodCentre: 'Blood centre',
  bloodRequest: 'Blood request',
  indication: 'Indication for transfusion',
  dateRequired: 'Date required',
  requestedBloodGroup: 'Requested blood group',
  product: 'Product',
  units: 'Units',
  crossmatchSample: 'Pre-transfusion compatibility testing sample',
  bloodGroupAndRh: 'ABO group and RhD type',

  /* Patient */
  patientName: 'Patient name',
  dateOfBirth: 'Date of birth',
  age: 'Age',
  sex: 'Sex',
  hospitalId: 'Hospital ID (UHID/MRN)',
  attenderName: 'Attender name',
  attenderPhone: 'Attender phone',
  knownDiagnosis: 'Known diagnosis',
  relevantHistory: 'Relevant history',
  previousTransfusion: 'Previous transfusion',
  previousReaction: 'Reaction to previous transfusion',

  /* Admission */
  ipNumber: 'IP number',
  ward: 'Ward number',
  admittedAt: 'Admitted at',
  dischargedAt: 'Discharged at',

  /* Module 3 — donors. Here so the whole vocabulary is in one place. */
  deferral: 'Deferral',
  interDonationInterval: 'Inter-donation interval',
  donorQuestionnaire: 'Donor health questionnaire',
  /** Donor-facing copy stays plain: "Needed by", not "Date required" (§2.7). */
  neededBy: 'Needed by',
} as const;

export type WordingKey = keyof typeof WORDING;

/**
 * Terms that must never appear in an interface, and what to say instead.
 *
 * Asserted against the vocabulary above by a test. It cannot police every
 * string in the codebase — that would be a linter, and a noisy one — but it
 * does stop the wrong word entering through the one door every screen uses.
 */
export const FORBIDDEN_TERMS: Readonly<Record<string, string>> = {
  'blood bank': WORDING.bloodCentre,
  'rh factor': WORDING.bloodGroupAndRh,
  cooldown: WORDING.interDonationInterval,
  'blood sample': WORDING.crossmatchSample,
  'screening questions': WORDING.donorQuestionnaire,
  eliminated: WORDING.deferral,
  rejected: WORDING.deferral,
  banned: WORDING.deferral,
  'packed cells': 'Packed Red Blood Cells (PRBC)',
  'date needed': WORDING.dateRequired,
};
