/**
 * Core domain vocabulary for KobeOS.
 *
 * The four participants of the workflow map onto types as follows:
 *
 *   Soko Huru (agency)  -> AgencyStaff, VacancyDraft, agency dashboard views
 *   KobeOS (platform)   -> the services in src/services, this vocabulary
 *   Employer client     -> Employer, EmployerPortal, EmployerAccessGrant
 *   Applicant           -> Applicant, Cv, ApplicantPreferences, Membership
 */

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

export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'casual' | 'internship';

export type WorkMode = 'onsite' | 'remote' | 'hybrid';

/** A vacancy may be restricted by the employer client. `any` is the gender-neutral default. */
export type GenderRequirement = 'any' | 'female' | 'male';

export type EducationLevel =
  | 'none'
  | 'primary'
  | 'secondary'
  | 'certificate'
  | 'diploma'
  | 'degree'
  | 'postgraduate';

/** Ordered weakest -> strongest, used for "at least this level" comparisons. */
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
  /** Normalised monthly value in TZS, used for filtering and comparison. */
  monthlyTzs: number | null;
};

/** How a vacancy reached Soko Huru, retained for audit and for the source image. */
export type IntakeChannel =
  | 'poster_image'
  | 'screenshot'
  | 'whatsapp_text'
  | 'pasted_text'
  | 'pdf'
  | 'manual_entry'
  | 'email';

/**
 * The structured vacancy Kobe AI pulls out of a Soko Huru poster or message.
 * Every field carries its own confidence so agency staff can see what to check
 * before pressing Publish.
 */
export type ExtractedVacancy = {
  title: string | null;
  employerName: string | null;
  location: string | null;
  category: JobCategory | null;
  positions: number | null;
  salary: Salary | null;
  accommodationProvided: boolean | null;
  mealsProvided: boolean | null;
  transportProvided: boolean | null;
  employmentType: EmploymentType | null;
  workMode: WorkMode | null;
  genderRequirement: GenderRequirement | null;
  ageMin: number | null;
  ageMax: number | null;
  languages: string[];
  experienceYearsMin: number | null;
  experienceNote: string | null;
  educationMin: EducationLevel | null;
  certificateRequired: boolean | null;
  immediateStart: boolean | null;
  startDate: string | null;
  applicationDeadline: string | null;
};

export type FieldConfidence = {
  field: keyof ExtractedVacancy;
  /** 0..1 - how sure the extractor is. Anything below REVIEW_THRESHOLD is flagged. */
  confidence: number;
  /** The line of the poster the value came from, shown to staff during review. */
  evidence: string | null;
};

export type ExtractionResult = {
  vacancy: ExtractedVacancy;
  confidence: FieldConfidence[];
  /** Fields the extractor wants a human to confirm before publishing. */
  needsReview: (keyof ExtractedVacancy)[];
  extractor: string;
  detectedLanguage: 'en' | 'sw' | 'mixed';
};

/** Pluggable extraction backend. The rule-based engine is the default; an LLM
 *  adapter can be injected without the rest of the system knowing. */
export type VacancyExtractor = {
  readonly name: string;
  extract(rawText: string): Promise<ExtractionResult> | ExtractionResult;
};

export type VacancyStatus = 'draft' | 'published' | 'paused' | 'filled' | 'closed';

export type Vacancy = {
  id: string;
  employerId: string;
  agencyRef: string;
  slug: string;
  status: VacancyStatus;
  title: string;
  location: string;
  category: JobCategory;
  positions: number;
  salary: Salary;
  accommodationProvided: boolean;
  mealsProvided: boolean;
  transportProvided: boolean;
  employmentType: EmploymentType;
  workMode: WorkMode;
  genderRequirement: GenderRequirement;
  ageMin: number | null;
  ageMax: number | null;
  languages: string[];
  experienceYearsMin: number;
  experienceNote: string | null;
  educationMin: EducationLevel;
  certificateRequired: boolean;
  immediateStart: boolean;
  startDate: string | null;
  applicationDeadline: string | null;
  description: string | null;
  /** The original Soko Huru poster, still shown on the detail page. */
  sourceImagePath: string | null;
  sourceText: string | null;
  intakeChannel: IntakeChannel;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** The Tinder-style card the applicant swipes. */
export type JobCard = {
  vacancyId: string;
  title: string;
  location: string;
  salaryLine: string;
  positionsLine: string;
  highlights: string[];
  postedThrough: string;
  matchScore: number;
  matchReasons: string[];
  sourceImagePath: string | null;
  actions: {
    right: 'apply';
    left: 'skip';
    up: 'save';
    tap: 'view_details';
  };
};

export type SwipeDirection = 'right' | 'left' | 'up';

export type Applicant = {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  location: string;
  gender: 'female' | 'male' | 'other' | 'undisclosed';
  dateOfBirth: string | null;
  educationLevel: EducationLevel;
  languages: string[];
  willingToRelocate: boolean;
  availableFrom: string | null;
  sokoHuruVerified: boolean;
  createdAt: string;
};

export type Cv = {
  id: string;
  applicantId: string;
  label: string;
  categories: JobCategory[];
  headline: string | null;
  experienceYears: number;
  educationLevel: EducationLevel;
  skills: string[];
  languages: string[];
  certificates: string[];
  preferredSalaryTzs: number | null;
  filePath: string | null;
  isDefault: boolean;
  createdAt: string;
};

/** What the applicant chooses to see before swiping. */
export type ApplicantPreferences = {
  applicantId: string;
  locations: string[];
  categories: JobCategory[];
  minSalaryTzs: number | null;
  maxSalaryTzs: number | null;
  certificateRequired: boolean | null;
  educationLevelMax: EducationLevel | null;
  experienceYearsMax: number | null;
  accommodationRequiredOutsideHome: boolean;
  employmentTypes: EmploymentType[];
  workModes: WorkMode[];
  willingToRelocate: boolean;
  genderNeutralOnly: boolean;
  immediateStartOnly: boolean;
  updatedAt: string;
};

export type MembershipPackageCode = string;

/**
 * Soko Huru owns the package names, prices and durations. KobeOS only enforces
 * them, so every rule here is a data row rather than a branch in the code.
 */
export type MembershipPackage = {
  code: MembershipPackageCode;
  name: string;
  priceTzs: number;
  durationDays: number;
  coversNonCertificateJobs: boolean;
  coversCertificateJobs: boolean;
  /** null = unlimited applications for the life of the membership. */
  applicationLimit: number | null;
  categories: JobCategory[] | null;
  priorityReview: boolean;
  active: boolean;
};

export type MembershipStatus = 'pending_payment' | 'active' | 'expired' | 'cancelled';

export type Membership = {
  id: string;
  applicantId: string;
  packageCode: MembershipPackageCode;
  status: MembershipStatus;
  paidAmountTzs: number | null;
  paymentReference: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  applicationsUsed: number;
  createdAt: string;
};

export type ApplicationStatus =
  | 'applied'
  | 'viewed'
  | 'shortlisted'
  | 'interview_invited'
  | 'interview_completed'
  | 'hired'
  | 'rejected'
  | 'withdrawn';

export const APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  'applied',
  'viewed',
  'shortlisted',
  'interview_invited',
  'interview_completed',
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
  /** Human-facing number, e.g. SH-2026-001284. */
  reference: string;
  vacancyId: string;
  applicantId: string;
  cvId: string;
  employerId: string;
  status: ApplicationStatus;
  matchScore: number;
  employerNotes: string | null;
  interviewAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ApplicationEvent = {
  id: number;
  applicationId: string;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  actorKind: Actor['kind'];
  actorId: string;
  note: string | null;
  createdAt: string;
};

export type Employer = {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  location: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  createdAt: string;
};

/** The recruitment portal KobeOS generates for the employer automatically. */
export type EmployerPortal = {
  employerId: string;
  url: string;
  createdAt: string;
};

export type AccessGrantKind = 'password' | 'one_time_code' | 'email_otp' | 'phone_otp';

export type EmployerAccessGrant = {
  id: string;
  employerId: string;
  kind: AccessGrantKind;
  /** Never the secret itself - always a salted hash. */
  secretHash: string;
  destination: string | null;
  expiresAt: string | null;
  usedAt: string | null;
  attempts: number;
  createdAt: string;
};

export type VacancyStats = {
  vacancyId: string;
  title: string;
  location: string;
  positions: number;
  applications: number;
  newApplications: number;
  viewed: number;
  shortlisted: number;
  interviewInvited: number;
  interviewCompleted: number;
  rejected: number;
  hired: number;
  remainingPositions: number;
};

export type AgencyOverviewRow = {
  employerId: string;
  employerName: string;
  vacancyId: string;
  jobTitle: string;
  applications: number;
  newApplications: number;
  hired: number;
  remainingPositions: number;
  /** Highlights clients who have not looked at their candidates yet. */
  employerLastSeenAt: string | null;
  unreviewedApplications: number;
};
