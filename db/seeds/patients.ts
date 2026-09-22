/**
 * Synthetic patients and their admissions (build plan, P13's "the synthetic
 * dataset").
 *
 * Nothing before this seeded a patient or an admission: the fridge and the
 * donor pool were demonstrable from a fresh database, but the request flow
 * (§2, §3) had nowhere to start from except a patient created by hand in the
 * running app, and a demo walkthrough that begins "first, type in a patient"
 * is not the loop in §1.
 *
 * Every UHID is `SYN-PT-NNNN` and every IP number is `SYN-IP-NNNN`, both
 * unique on the row, which is what keeps this idempotent: a re-run's
 * `onConflictDoNothing()` matches on those, not on the freshly generated id
 * (the same pattern `stock.ts`'s unit numbers and `donors.ts`'s channel ids
 * use). No real patient, attender or diagnosis enters this system at any
 * point, including "just to test".
 */

import { type BloodGroup } from '@blood-connect/domain';
import { newId } from '@blood-connect/ids';

export const SYNTHETIC_PATIENT_PREFIX = 'SYN-PT-';
export const SYNTHETIC_IP_PREFIX = 'SYN-IP-';

export type PatientSeed = {
  readonly id: string;
  readonly uhid: string;
  readonly name: string;
  readonly dob: string | null;
  readonly age: number | null;
  readonly ageUnit: 'days' | 'months' | 'years' | null;
  readonly sex: 'female' | 'male' | 'other';
  readonly bloodGroup: BloodGroup;
  readonly attenderName: string;
  readonly attenderPhone: string;
  readonly diagnosis: string;
  readonly previousTransfusion: 'yes' | 'no' | 'unknown';
  readonly previousReaction: string | null;
};

export type AdmissionSeed = {
  readonly id: string;
  readonly patientUhid: string;
  readonly ipNo: string;
  readonly ward: string;
  readonly admittedAt: Date;
};

/**
 * Eight patients, none at a case-3 boundary (that is the test suite's job),
 * spread across sexes, blood groups and ages, including the neonate case §3
 * names explicitly (recorded in days, no date of birth) and one prior
 * transfusion reaction, because a request review screen that only ever shows
 * "unknown" demonstrates nothing about the field.
 */
const PATIENTS: readonly Omit<PatientSeed, 'id'>[] = [
  {
    uhid: `${SYNTHETIC_PATIENT_PREFIX}0001`,
    name: 'Reshma Varghese (seed)',
    dob: null,
    age: 34,
    ageUnit: 'years',
    sex: 'female',
    bloodGroup: 'O-',
    attenderName: 'Biju Varghese (seed)',
    attenderPhone: '+919900010001',
    diagnosis: 'Postpartum haemorrhage',
    previousTransfusion: 'no',
    previousReaction: null,
  },
  {
    uhid: `${SYNTHETIC_PATIENT_PREFIX}0002`,
    name: 'Mohammed Ashraf (seed)',
    dob: null,
    age: 58,
    ageUnit: 'years',
    sex: 'male',
    bloodGroup: 'B+',
    attenderName: 'Sameera Ashraf (seed)',
    attenderPhone: '+919900010002',
    diagnosis: 'GI bleed, on anticoagulants',
    previousTransfusion: 'yes',
    previousReaction: 'Mild febrile reaction, resolved without treatment',
  },
  {
    uhid: `${SYNTHETIC_PATIENT_PREFIX}0003`,
    name: 'Baby of Priya Nair (seed)',
    dob: null,
    age: 2,
    ageUnit: 'days',
    sex: 'other',
    bloodGroup: 'A+',
    attenderName: 'Priya Nair (seed)',
    attenderPhone: '+919900010003',
    diagnosis: 'Neonatal jaundice, exchange transfusion planned',
    previousTransfusion: 'no',
    previousReaction: null,
  },
  {
    uhid: `${SYNTHETIC_PATIENT_PREFIX}0004`,
    name: 'Thankamma Pillai (seed)',
    dob: null,
    age: 71,
    ageUnit: 'years',
    sex: 'female',
    bloodGroup: 'AB+',
    attenderName: 'Suresh Pillai (seed)',
    attenderPhone: '+919900010004',
    diagnosis: 'Hip fracture, pre-operative',
    previousTransfusion: 'unknown',
    previousReaction: null,
  },
  {
    uhid: `${SYNTHETIC_PATIENT_PREFIX}0005`,
    name: 'Arun Kumar (seed)',
    dob: null,
    age: 19,
    ageUnit: 'years',
    sex: 'male',
    bloodGroup: 'O+',
    attenderName: 'Kumaran Nair (seed)',
    attenderPhone: '+919900010005',
    diagnosis: 'Road traffic accident, polytrauma',
    previousTransfusion: 'no',
    previousReaction: null,
  },
  {
    uhid: `${SYNTHETIC_PATIENT_PREFIX}0006`,
    name: 'Fathima Beevi (seed)',
    dob: null,
    age: 45,
    ageUnit: 'years',
    sex: 'female',
    bloodGroup: 'B-',
    attenderName: 'Ismail Beevi (seed)',
    attenderPhone: '+919900010006',
    diagnosis: 'Elective surgery, thalassemia on regular transfusion',
    previousTransfusion: 'yes',
    previousReaction: null,
  },
  {
    uhid: `${SYNTHETIC_PATIENT_PREFIX}0007`,
    name: 'George Mathew (seed)',
    dob: null,
    age: 63,
    ageUnit: 'years',
    sex: 'male',
    bloodGroup: 'AB-',
    attenderName: 'Elsamma Mathew (seed)',
    attenderPhone: '+919900010007',
    diagnosis: 'Chronic kidney disease, dialysis-related anaemia',
    previousTransfusion: 'yes',
    previousReaction: null,
  },
  {
    uhid: `${SYNTHETIC_PATIENT_PREFIX}0008`,
    name: 'Devika Menon (seed)',
    dob: null,
    age: 27,
    ageUnit: 'years',
    sex: 'female',
    bloodGroup: 'A-',
    attenderName: 'Ramesh Menon (seed)',
    attenderPhone: '+919900010008',
    diagnosis: 'Dengue with thrombocytopenia',
    previousTransfusion: 'no',
    previousReaction: null,
  },
];

type AdmissionSpec = {
  readonly patientUhid: string;
  readonly ipNo: string;
  readonly ward: string;
  readonly admittedDaysAgo: number;
};

/** One admission per patient. Spread over recent days, one still on the ward. */
const ADMISSIONS: readonly AdmissionSpec[] = [
  { patientUhid: `${SYNTHETIC_PATIENT_PREFIX}0001`, ipNo: `${SYNTHETIC_IP_PREFIX}0001`, ward: 'Obstetrics', admittedDaysAgo: 1 },
  { patientUhid: `${SYNTHETIC_PATIENT_PREFIX}0002`, ipNo: `${SYNTHETIC_IP_PREFIX}0002`, ward: 'Gastroenterology', admittedDaysAgo: 3 },
  { patientUhid: `${SYNTHETIC_PATIENT_PREFIX}0003`, ipNo: `${SYNTHETIC_IP_PREFIX}0003`, ward: 'NICU', admittedDaysAgo: 0 },
  { patientUhid: `${SYNTHETIC_PATIENT_PREFIX}0004`, ipNo: `${SYNTHETIC_IP_PREFIX}0004`, ward: 'Orthopaedics', admittedDaysAgo: 2 },
  { patientUhid: `${SYNTHETIC_PATIENT_PREFIX}0005`, ipNo: `${SYNTHETIC_IP_PREFIX}0005`, ward: 'Trauma ICU', admittedDaysAgo: 0 },
  { patientUhid: `${SYNTHETIC_PATIENT_PREFIX}0006`, ipNo: `${SYNTHETIC_IP_PREFIX}0006`, ward: 'Day Care', admittedDaysAgo: 4 },
  { patientUhid: `${SYNTHETIC_PATIENT_PREFIX}0007`, ipNo: `${SYNTHETIC_IP_PREFIX}0007`, ward: 'Nephrology', admittedDaysAgo: 5 },
  { patientUhid: `${SYNTHETIC_PATIENT_PREFIX}0008`, ipNo: `${SYNTHETIC_IP_PREFIX}0008`, ward: 'Medicine', admittedDaysAgo: 1 },
];

export function buildPatientSeed(): PatientSeed[] {
  return PATIENTS.map((patient) => ({ ...patient, id: newId() }));
}

/** @param now Injected so the seed is exercisable from a fixed clock in tests. */
export function buildAdmissionSeed(now: Date = new Date()): AdmissionSeed[] {
  return ADMISSIONS.map(({ admittedDaysAgo, ...admission }) => ({
    ...admission,
    id: newId(),
    admittedAt: new Date(now.getTime() - admittedDaysAgo * 86_400_000),
  }));
}
