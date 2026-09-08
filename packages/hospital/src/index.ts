/**
 * Module 1's only entry point (§2).
 *
 * Patients, admissions and blood requests. It may import `platform` and the
 * shared packages; it must never read a `blood_bags` row, and nothing outside
 * it may read its tables — the narrow read API below is how the centre and the
 * administration application get what they need.
 */

export {
  createAdmission,
  createDraft,
  createPatient,
  dischargeAdmission,
  getRequest,
  isOverdue,
  listAdmissions,
  listRequestsForDoctor,
  updateDraft,
  type AdmissionInput,
  type DraftInput,
  type PatientInput,
  type RequestListRow,
} from './use-cases/records.js';

export { submitRequest, type SubmitResult } from './use-cases/submit.js';

export {
  getDoctorActivity,
  getPatientsForDoctor,
  type DoctorActivity,
  type PatientRow,
} from './read.js';

export {
  admissionNotFound,
  incompleteDraft,
  invalidPatient,
  ipNumberTaken,
  patientNotFound,
  requestNotADraft,
  requestNotFound,
  type DraftError,
  type SubmitError,
} from './errors.js';
