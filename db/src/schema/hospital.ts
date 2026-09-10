/**
 * The `hospital` schema, Module 1 (§5.4).
 *
 * Patients, admissions, blood requests, and the counter that allocates their
 * identifiers. Owned by the `hospital` module, which may import `platform` and
 * the shared packages but must never read a `blood_bags` row (§2).
 */

import { relations, sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { hospitalSchema, users } from './platform.js';
import { locationNodes } from './reference.js';

/**
 * The tenant a request belongs to.
 *
 * §5.4 puts `centre_id` on `blood_requests` and `donor_demand` from day one so
 * multi-tenant is not a retrofit, even though v1 runs one centre, but it names
 * no table for that id to point at. A NOT NULL column referring to nothing is
 * worse than the retrofit it avoids, so this is the referent. `centre_settings`
 * in P3 holds the single deployment's configuration and hangs off it.
 *
 * Recorded as a spec delta in the ADR.
 */
export const centres = hospitalSchema.table('centres', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* -------------------------------------------------------------------------- */
/* Patients                                                                    */
/* -------------------------------------------------------------------------- */

export const AGE_UNITS = ['days', 'months', 'years'] as const;
export type AgeUnit = (typeof AGE_UNITS)[number];

export const SEXES = ['female', 'male', 'other'] as const;

export const PREVIOUS_TRANSFUSION = ['yes', 'no', 'unknown'] as const;
export type PreviousTransfusion = (typeof PREVIOUS_TRANSFUSION)[number];

export const patients = hospitalSchema.table(
  'patients',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    /**
     * Either a date of birth or an age with its unit. A neonate is recorded in
     * days, and demanding a birth date for one is how a real admission gets
     * blocked at 3am (§3).
     */
    dob: date('dob'),
    age: integer('age'),
    ageUnit: text('age_unit'),
    sex: text('sex').notNull(),
    bloodGroup: text('blood_group').notNull(),
    /** Hospital number, where the patient has one. Unique when present. */
    uhid: text('uhid'),
    attenderName: text('attender_name'),
    attenderPhone: text('attender_phone'),
    address: text('address'),
    districtId: text('district_id').references(() => locationNodes.id),
    cityId: text('city_id').references(() => locationNodes.id),
    diagnosis: text('diagnosis'),
    history: text('history'),
    previousTransfusion: text('previous_transfusion').notNull().default('unknown'),
    previousReaction: text('previous_reaction'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The neonate case (§3), as a constraint rather than a convention.
    check('patients_age_check', sql`dob IS NOT NULL OR (age IS NOT NULL AND age_unit IS NOT NULL)`),
    check('patients_age_unit_check', sql`age_unit IS NULL OR age_unit IN ('days', 'months', 'years')`),
    check('patients_age_nonneg_check', sql`age IS NULL OR age >= 0`),
    check('patients_sex_check', sql`sex IN ('female', 'male', 'other')`),
    check(
      'patients_blood_group_check',
      sql`blood_group IN ('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+')`,
    ),
    check(
      'patients_previous_transfusion_check',
      sql`previous_transfusion IN ('yes', 'no', 'unknown')`,
    ),
    // A reaction is recorded only where there was a previous transfusion.
    check(
      'patients_reaction_check',
      sql`previous_reaction IS NULL OR previous_transfusion = 'yes'`,
    ),
    uniqueIndex('patients_uhid_idx').on(table.uhid).where(sql`uhid IS NOT NULL`),
    index('patients_created_idx').on(table.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Admissions                                                                  */
/* -------------------------------------------------------------------------- */

export const ADMISSION_STATUSES = ['admitted', 'discharged'] as const;
export type AdmissionStatus = (typeof ADMISSION_STATUSES)[number];

export const admissions = hospitalSchema.table(
  'admissions',
  {
    id: uuid('id').primaryKey(),
    /** The primary identity of an admission on the ward, and immutable (§3). */
    ipNo: text('ip_no').notNull(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    ward: text('ward').notNull(),
    admittedAt: timestamp('admitted_at', { withTimezone: true }).notNull(),
    dischargedAt: timestamp('discharged_at', { withTimezone: true }),
    status: text('status').notNull().default('admitted'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('admissions_ip_no_idx').on(table.ipNo),
    index('admissions_patient_idx').on(table.patientId, table.admittedAt.desc()),
    check('admissions_status_check', sql`status IN ('admitted', 'discharged')`),
    check(
      'admissions_discharge_check',
      sql`discharged_at IS NULL OR discharged_at >= admitted_at`,
    ),
    // Status and the timestamp cannot disagree.
    check('admissions_status_consistency', sql`(status = 'discharged') = (discharged_at IS NOT NULL)`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Blood requests                                                              */
/* -------------------------------------------------------------------------- */

export const BLOOD_REQUEST_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'partially_approved',
  'declined',
  'cancelled',
] as const;

export const bloodRequests = hospitalSchema.table(
  'blood_requests',
  {
    id: uuid('id').primaryKey(),
    /** `DDMMYY-NNNNN`, allocated at submit and never before (§7.1). */
    requestId: text('request_id'),
    centreId: uuid('centre_id')
      .notNull()
      .references(() => centres.id),
    /**
     * Null until the centre attaches a patient (ADR 0010).
     *
     * The doctor gives four fields and an ID; the patient is identified at the
     * counter, when the bystander arrives with it. Only an `emergency` request
     * may be reserved against or issued while this is null, and the decision
     * records that it was.
     */
    admissionId: uuid('admission_id').references(() => admissions.id),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => users.id),
    status: text('status').notNull().default('submitted'),
    /**
     * How fast it needs answering, and what `date_required` was derived from.
     *
     * Kept alongside the derived date rather than instead of it: three of the
     * four levels mean today, so the date cannot order the queue and the level
     * cannot drive the expiry sweep. Each answers what the other cannot.
     */
    urgency: text('urgency'),
    /** Recorded by whoever has it. The doctor if they had a moment, else the centre. */
    indication: text('indication'),
    /** The centre records a day, not an instant (§5.2). */
    dateRequired: date('date_required'),
    bloodGroup: text('blood_group'),
    product: text('product'),
    units: integer('units'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    /**
     * Frozen at submit (§2.6).
     *
     * The patient's details and the doctor's identity as they were when the
     * request was made, because a request is a clinical record of what was
     * asked for, and editing a patient's name a month later must not silently
     * rewrite what the centre was told. Never joined on.
     */
    patientSnapshot: jsonb('patient_snapshot'),
    doctorSnapshot: jsonb('doctor_snapshot'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('blood_requests_request_id_idx')
      .on(table.requestId)
      .where(sql`request_id IS NOT NULL`),
    // The centre queue, and the derived overdue flag (§3).
    index('blood_requests_queue_idx').on(table.status, table.dateRequired),
    // Stale drafts on the doctor's dashboard.
    index('blood_requests_doctor_idx').on(table.doctorId, table.updatedAt.desc()),
    index('blood_requests_admission_idx').on(table.admissionId),
    check(
      'blood_requests_status_check',
      sql`status IN ('draft', 'submitted', 'approved', 'partially_approved', 'declined', 'cancelled')`,
    ),
    /**
     * Everything past `draft` carries its identifier, its four fields and the
     * doctor who asked.
     *
     * **The patient is no longer among them** (ADR 0010): a request is raised
     * with four fields, and the patient is identified later at the counter. So
     * `patient_snapshot` and `indication` left this list. What remains is
     * exactly what the doctor supplies, and a request missing any of it is a
     * request nobody could act on.
     *
     * `draft` survives in the status check for rows raised before ADR 0010.
     * Nothing creates one any more; deleting them would destroy the only record
     * that something was intended.
     */
    check(
      'blood_requests_submitted_check',
      sql`status = 'draft' OR (
        request_id IS NOT NULL
        AND doctor_snapshot IS NOT NULL
        AND submitted_at IS NOT NULL
        AND urgency IS NOT NULL
        AND date_required IS NOT NULL
        AND blood_group IS NOT NULL
        AND product IS NOT NULL
        AND units IS NOT NULL
      )`,
    ),
    /**
     * The patient snapshot cannot exist without the patient.
     *
     * They are written together when the centre attaches one, and a snapshot
     * without an admission would be a frozen copy of a record nothing points
     * at. Unreadable and unverifiable (§2.6).
     */
    check(
      'blood_requests_patient_check',
      sql`patient_snapshot IS NULL OR admission_id IS NOT NULL`,
    ),
    check(
      'blood_requests_urgency_check',
      sql`urgency IS NULL OR urgency IN ('emergency', 'very_urgent', 'urgent', 'routine')`,
    ),
    check('blood_requests_units_check', sql`units IS NULL OR units >= 1`),
    check(
      'blood_requests_blood_group_check',
      sql`blood_group IS NULL OR blood_group IN ('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+')`,
    ),
    check(
      'blood_requests_product_check',
      sql`product IS NULL OR product IN ('whole_blood', 'prbc', 'platelet_concentrate', 'ffp', 'cryoprecipitate')`,
    ),
    check(
      'blood_requests_cancel_check',
      sql`(status = 'cancelled') = (cancelled_at IS NOT NULL)`,
    ),
  ],
);

/**
 * The pre-transfusion compatibility testing sample (§5.4, §15).
 *
 * §2.7 calls it that, never "blood sample". The wording table exists because
 * the imprecise term is what somebody reaches for under pressure.
 *
 * `sample_identifier` is unique **on its own**, not per request. §15 wants it
 * globally unique because the identifier travels on a physical tube between the
 * ward and the laboratory: two tubes carrying the same label, for different
 * patients, is exactly the mix-up the compatibility test exists to prevent.
 */
export const bloodSamples = hospitalSchema.table(
  'blood_samples',
  {
    id: uuid('id').primaryKey(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => bloodRequests.id),
    sampleIdentifier: text('sample_identifier').notNull(),
    collectedAt: timestamp('collected_at', { withTimezone: true }).notNull(),
    /** The authenticated doctor who drew it, from the session (§2.5). */
    collectedByDoctorId: uuid('collected_by_doctor_id').references(() => users.id),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Globally unique, deliberately. See above.
    uniqueIndex('blood_samples_identifier_idx').on(table.sampleIdentifier),
    index('blood_samples_request_idx').on(table.requestId, table.collectedAt.desc()),
  ],
);

/**
 * The transactional allocator of §7.1.
 *
 * One row per year, incremented inside the submit transaction. Not a sequence:
 * a sequence hands out a number that is gone whether or not the transaction
 * commits, so a failed submit would burn an identifier and leave a visible gap
 * in a clinical record series.
 */
/**
 * The §7.1 allocator, keyed by **day** since ADR 0010.
 *
 * `DDMMYY-NNNNN` restarts its sequence each day, so the counter does too. The
 * row per day is also the natural place to answer "how many requests did we
 * take yesterday?" without scanning the table.
 */
export const bloodRequestCounters = hospitalSchema.table('blood_request_counters', {
  day: date('day').primaryKey(),
  nextValue: integer('next_value').notNull(),
});

/* -------------------------------------------------------------------------- */
/* Relations                                                                   */
/* -------------------------------------------------------------------------- */

export const patientRelations = relations(patients, ({ many }) => ({
  admissions: many(admissions),
}));

export const admissionRelations = relations(admissions, ({ one, many }) => ({
  patient: one(patients, { fields: [admissions.patientId], references: [patients.id] }),
  requests: many(bloodRequests),
}));

export const bloodRequestRelations = relations(bloodRequests, ({ one }) => ({
  admission: one(admissions, {
    fields: [bloodRequests.admissionId],
    references: [admissions.id],
  }),
  doctor: one(users, { fields: [bloodRequests.doctorId], references: [users.id] }),
}));
