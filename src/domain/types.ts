/**
 * KobeOS MVP domain vocabulary.
 *
 * KobeOS is the platform; a tenant is the recruitment agency using it. Today
 * the only tenant is Soko Huru, so every record carries a tenant_id and no
 * rule is hard-coded to one agency.
 *
 *   Tenant (Soko Huru)
 *     |- agency users  - upload posters, publish jobs, confirm payments
 *     |- applicants    - register, pay, swipe, apply
 *     |- employers     - open their private link, review candidates
 *     |- jobs          - published from the agency's existing posters
 *     `- applications  - created by a right swipe
 */

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
};

export type UserRole = 'agency_admin' | 'agency_staff' | 'applicant';

export type User = {
  id: string;
  tenantId: string;
  role: UserRole;
  fullName: string;
  phone: string;
  email: string | null;
  createdAt: string;
};

export type JobCategory =
  | 'hospitality'
  | 'customer_care'
  | 'driving'
  | 'teaching'
  | 'security'
  | 'retail'
  | 'construction'
  | 'domestic'
  | 'healthcare'
  | 'it'
  | 'finance'
  | 'sales'
  | 'other';

export const JOB_CATEGORIES: readonly JobCategory[] = [
  'hospitality',
  'customer_care',
  'driving',
  'teaching',
  'security',
  'retail',
  'construction',
  'domestic',
  'healthcare',
  'it',
  'finance',
  'sales',
  'other',
];

export type EducationLevel =
  | 'none'
  | 'primary'
  | 'secondary'
  | 'certificate'
  | 'diploma'
  | 'degree'
  | 'postgraduate';

export const EDUCATION_ORDER: readonly EducationLevel[] = [
  'none',
  'primary',
  'secondary',
  'certificate',
  'diploma',
  'degree',
  'postgraduate',
];

export type Currency = 'TZS' | 'USD' | 'KES' | 'EUR';

export type SalaryPeriod = 'hour' | 'day' | 'week' | 'month' | 'year';

export type Salary = {
  amountMin: number | null;
  amountMax: number | null;
  currency: Currency;
  period: SalaryPeriod;
  plusTips: boolean;
  /** Normalised monthly TZS value, so one filter can compare USD and TZS pay. */
  monthlyTzs: number | null;
};

export type IntakeChannel =
  | 'poster_image'
  | 'pasted_text'
  | 'whatsapp_text'
  | 'manual_entry'
  /** Typed by the employer client themselves, into their own private page. */
  | 'employer_form';

/**
 * What Kobe AI reads out of a poster. The MVP extracts the fields the agency
 * asked for, plus the handful the swipe card itself prints.
 */
export type ExtractedJob = {
  title: string | null;
  employerName: string | null;
  location: string | null;
  category: JobCategory | null;
  positions: number | null;
  salary: Salary | null;
  description: string | null;
  responsibilities: string[];
  requirements: string[];
  applicationDeadline: string | null;
  contactInfo: string | null;
  accommodationProvided: boolean | null;
  languages: string[];
  experienceNote: string | null;
  certificateRequired: boolean | null;
  immediateStart: boolean | null;
};

export type ExtractedField = keyof ExtractedJob;

export type FieldConfidence = {
  field: ExtractedField;
  /** 0..1. Below the review threshold the field is flagged for staff. */
  confidence: number;
  /** The poster line the value came from, so staff can compare side by side. */
  evidence: string | null;
};

export type ExtractionResult = {
  job: ExtractedJob;
  confidence: FieldConfidence[];
  needsReview: ExtractedField[];
  extractor: string;
  detectedLanguage: 'en' | 'sw' | 'mixed';
};

export type JobExtractor = {
  readonly name: string;
  extract(rawText: string): Promise<ExtractionResult> | ExtractionResult;
};

export type JobStatus = 'draft' | 'published' | 'filled' | 'closed';

export type Job = {
  id: string;
  tenantId: string;
  employerId: string;
  reference: string;
  status: JobStatus;
  title: string;
  location: string;
  category: JobCategory;
  positions: number;
  salary: Salary;
  description: string | null;
  responsibilities: string[];
  requirements: string[];
  applicationDeadline: string | null;
  contactInfo: string | null;
  accommodationProvided: boolean;
  languages: string[];
  experienceNote: string | null;
  certificateRequired: boolean;
  immediateStart: boolean;
  /** The original agency poster, shown beside the details. */
  sourceImagePath: string | null;
  sourceText: string | null;
  intakeChannel: IntakeChannel;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** The card that fills the applicant's screen. */
export type JobCard = {
  jobId: string;
  title: string;
  location: string;
  salaryLine: string;
  positionsLine: string;
  highlights: string[];
  employerName: string;
  postedThrough: string;
  sourceImagePath: string | null;
  saved: boolean;
};

export type SwipeDirection = 'left' | 'right' | 'up';

export type Applicant = {
  id: string;
  tenantId: string;
  fullName: string;
  phone: string;
  email: string | null;
  location: string;
  educationLevel: EducationLevel;
  experienceYears: number;
  skills: string[];
  languages: string[];
  photoPath: string | null;
  willingToRelocate: boolean;
  createdAt: string;
};

/** The four filters the MVP ships with. */
export type ApplicantPreferences = {
  applicantId: string;
  tenantId: string;
  categories: JobCategory[];
  locations: string[];
  minSalaryTzs: number | null;
  /** null = show both kinds of job. */
  certificateRequired: boolean | null;
  updatedAt: string;
};

export type ApplicantDocumentKind = 'cv' | 'certificate' | 'licence' | 'identity' | 'other';

export type ApplicantDocument = {
  id: string;
  tenantId: string;
  applicantId: string;
  kind: ApplicantDocumentKind;
  label: string;
  filePath: string;
  filename: string;
  contentType: string;
  createdAt: string;
};

export type CvCertificate = { label: string; filePath: string | null };

/** One CV per applicant, generated by KobeOS from their profile. */
export type Cv = {
  id: string;
  tenantId: string;
  applicantId: string;
  fullName: string;
  headline: string;
  summary: string;
  location: string;
  phone: string;
  email: string | null;
  educationLevel: EducationLevel;
  experienceYears: number;
  categories: JobCategory[];
  skills: string[];
  languages: string[];
  certificates: CvCertificate[];
  photoPath: string | null;
  generatedAt: string;
};

export type MembershipPlan = {
  tenantId: string;
  code: string;
  name: string;
  priceTzs: number;
  durationDays: number;
  coversNonCertificateJobs: boolean;
  coversCertificateJobs: boolean;
  active: boolean;
};

export type MembershipStatus = 'pending_payment' | 'active' | 'expired' | 'cancelled';

export type Membership = {
  id: string;
  tenantId: string;
  applicantId: string;
  planCode: string;
  status: MembershipStatus;
  activatedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export type PaymentStatus = 'submitted' | 'confirmed' | 'rejected';

/** Pay, submit the transaction reference, agency confirms, membership starts. */
export type Payment = {
  id: string;
  tenantId: string;
  applicantId: string;
  membershipId: string;
  amountTzs: number;
  reference: string;
  method: string;
  status: PaymentStatus;
  note: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
};

export type Employer = {
  id: string;
  tenantId: string;
  name: string;
  /** The short code in the private link, e.g. /e/7HK29D. */
  accessCode: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  lastSeenAt: string | null;
  createdAt: string;
};

export type ApplicationStatus =
  | 'applied'
  | 'viewed'
  | 'shortlisted'
  | 'interview'
  | 'hired'
  | 'rejected'
  | 'withdrawn';

export const APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  'applied',
  'viewed',
  'shortlisted',
  'interview',
  'hired',
  'rejected',
  'withdrawn',
];

export type Actor =
  | { kind: 'employer'; id: string }
  | { kind: 'agency'; id: string }
  | { kind: 'applicant'; id: string }
  | { kind: 'system'; id: string };

export type Application = {
  id: string;
  tenantId: string;
  reference: string;
  jobId: string;
  applicantId: string;
  cvId: string;
  employerId: string;
  status: ApplicationStatus;
  employerNotes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ApplicationStatusChange = {
  id: number;
  tenantId: string;
  applicationId: string;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  actorKind: Actor['kind'];
  actorId: string;
  note: string | null;
  createdAt: string;
};

export type JobStats = {
  jobId: string;
  title: string;
  location: string;
  positions: number;
  applications: number;
  newApplications: number;
  viewed: number;
  shortlisted: number;
  interview: number;
  rejected: number;
  hired: number;
  remainingPositions: number;
};

/** One row of the agency's control table. */
export type AgencyOverviewRow = {
  employerId: string;
  employerName: string;
  jobId: string;
  jobTitle: string;
  applications: number;
  newApplications: number;
  shortlisted: number;
  hired: number;
  remainingPositions: number;
  employerLastSeenAt: string | null;
};
