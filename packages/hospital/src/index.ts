/**
 * Module 1's only entry point (§2).
 *
 * Patients, admissions and blood requests. It may import `platform` and the
 * shared packages; it must never read a `blood_bags` row, and nothing outside
 * it may read its tables. The narrow read API below is how the centre and the
 * administration application get what they need.
 */

export {
  createAdmission,
  createPatient,
  dischargeAdmission,
  findPossibleDuplicates,
  getRequest,
  isOverdue,
  listSamples,
  recordSample,
  listAdmissions,
  listRequestsForDoctor,
  type AdmissionInput,
  type PatientInput,
  type PossibleDuplicate,
  type SampleRow,
  type RequestListRow,
} from './use-cases/records.js';


export {
  getDoctorActivity,
  getPatientsForDoctor,
  type DoctorActivity,
  type PatientRow,
} from './read.js';

export {
  doctorOf,
  getRequestForDecision,
  admissionStateFor,
  attachPatient,
  findRequestByNumber,
  type AttachError,
  type AdmissionState,
  markRequestCancelled,
  listDecidedRequests,
  listRequestsAwaitingDecision,
  markRequestDecided,
  type CancelOutcome,
  type DecidedStatus,
  type DoctorSnapshot,
  type PatientSnapshot,
  type RequestForDecision,
} from './for-centre.js';

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

export {
  raiseRequest,
  type RaiseError,
  type RaiseInput,
  type RaiseResult,
  type RequestEssentials,
  type RequestExtras,
} from './use-cases/raise.js';

export {
  validatePatient,
  type PatientDetails,
  type PatientProblem,
} from './patient-record.js';
