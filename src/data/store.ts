import type { DatabaseSync } from 'node:sqlite';
import { APPLICATION_REFERENCE_PREFIX } from '../config.ts';
import { formatApplicationReference, newId } from '../domain/ids.ts';
import { withMonthlyTzs } from '../domain/salary.ts';
import type {
  AccessGrantKind,
  AgencyOverviewRow,
  Applicant,
  ApplicantPreferences,
  Application,
  ApplicationEvent,
  ApplicationStatus,
  Cv,
  Currency,
  EducationLevel,
  Employer,
  EmployerAccessGrant,
  EmploymentType,
  ExtractionResult,
  GenderRequirement,
  IntakeChannel,
  JobCategory,
  Membership,
  MembershipPackage,
  MembershipStatus,
  Actor,
  SalaryPeriod,
  SwipeDirection,
  Vacancy,
  VacancyStats,
  VacancyStatus,
  WorkMode,
} from '../domain/types.ts';
import {
  fromJsonArray,
  nowIso,
  numberOrNull,
  textOrNull,
  toBool,
  toBoolOrNull,
  toInt,
  toJson,
} from './db.ts';

type Row = Record<string, unknown>;

export type DraftStatus = 'extracted' | 'reviewed' | 'published' | 'discarded';

export type VacancyDraft = {
  id: string;
  employerId: string | null;
  employerNameGuess: string | null;
  intakeChannel: IntakeChannel;
  rawText: string | null;
  sourceImagePath: string | null;
  extraction: ExtractionResult;
  overrides: Record<string, unknown> | null;
  status: DraftStatus;
  vacancyId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RealtimeScope = 'employer' | 'agency' | 'applicant';

export type StoredEvent = {
  id: number;
  scope: RealtimeScope;
  scopeId: string;
  type: string;
  payload: unknown;
  createdAt: string;
};

export type EmployerApplicationFilters = {
  applicationId?: string;
  vacancyId?: string;
  status?: ApplicationStatus;
  location?: string;
  minExperienceYears?: number;
  education?: EducationLevel;
  language?: string;
  availableNow?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
};

/** An application joined with everything the employer card needs to render. */
export type ApplicationDetail = {
  application: Application;
  applicant: Applicant;
  cv: Cv;
  vacancyTitle: string;
  vacancyLocation: string;
};

function mapEmployer(row: Row): Employer {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    industry: textOrNull(row.industry),
    location: textOrNull(row.location),
    contactName: textOrNull(row.contact_name),
    contactPhone: textOrNull(row.contact_phone),
    contactEmail: textOrNull(row.contact_email),
    createdAt: String(row.created_at),
  };
}

function mapVacancy(row: Row): Vacancy {
  return {
    id: String(row.id),
    employerId: String(row.employer_id),
    agencyRef: String(row.agency_ref),
    slug: String(row.slug),
    status: String(row.status) as VacancyStatus,
    title: String(row.title),
    location: String(row.location),
    category: String(row.category) as JobCategory,
    positions: Number(row.positions),
    salary: withMonthlyTzs({
      amountMin: numberOrNull(row.salary_amount_min),
      amountMax: numberOrNull(row.salary_amount_max),
      currency: String(row.salary_currency) as Currency,
      period: String(row.salary_period) as SalaryPeriod,
      plusTips: toBool(row.salary_plus_tips),
    }),
    accommodationProvided: toBool(row.accommodation_provided),
    mealsProvided: toBool(row.meals_provided),
    transportProvided: toBool(row.transport_provided),
    employmentType: String(row.employment_type) as EmploymentType,
    workMode: String(row.work_mode) as WorkMode,
    genderRequirement: String(row.gender_requirement) as GenderRequirement,
    ageMin: numberOrNull(row.age_min),
    ageMax: numberOrNull(row.age_max),
    languages: fromJsonArray<string>(row.languages_json),
    experienceYearsMin: Number(row.experience_years_min),
    experienceNote: textOrNull(row.experience_note),
    educationMin: String(row.education_min) as EducationLevel,
    certificateRequired: toBool(row.certificate_required),
    immediateStart: toBool(row.immediate_start),
    startDate: textOrNull(row.start_date),
    applicationDeadline: textOrNull(row.application_deadline),
    description: textOrNull(row.description),
    sourceImagePath: textOrNull(row.source_image_path),
    sourceText: textOrNull(row.source_text),
    intakeChannel: String(row.intake_channel) as IntakeChannel,
    publishedAt: textOrNull(row.published_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapApplicant(row: Row): Applicant {
  return {
    id: String(row.id),
    fullName: String(row.full_name),
    phone: String(row.phone),
    email: textOrNull(row.email),
    location: String(row.location),
    gender: String(row.gender) as Applicant['gender'],
    dateOfBirth: textOrNull(row.date_of_birth),
    educationLevel: String(row.education_level) as EducationLevel,
    languages: fromJsonArray<string>(row.languages_json),
    willingToRelocate: toBool(row.willing_to_relocate),
    availableFrom: textOrNull(row.available_from),
    sokoHuruVerified: toBool(row.soko_huru_verified),
    createdAt: String(row.created_at),
  };
}

function mapCv(row: Row): Cv {
  return {
    id: String(row.id),
    applicantId: String(row.applicant_id),
    label: String(row.label),
    categories: fromJsonArray<JobCategory>(row.categories_json),
    headline: textOrNull(row.headline),
    experienceYears: Number(row.experience_years),
    educationLevel: String(row.education_level) as EducationLevel,
    skills: fromJsonArray<string>(row.skills_json),
    languages: fromJsonArray<string>(row.languages_json),
    certificates: fromJsonArray<string>(row.certificates_json),
    preferredSalaryTzs: numberOrNull(row.preferred_salary_tzs),
    filePath: textOrNull(row.file_path),
    isDefault: toBool(row.is_default),
    createdAt: String(row.created_at),
  };
}

function mapPreferences(row: Row): ApplicantPreferences {
  return {
    applicantId: String(row.applicant_id),
    locations: fromJsonArray<string>(row.locations_json),
    categories: fromJsonArray<JobCategory>(row.categories_json),
    minSalaryTzs: numberOrNull(row.min_salary_tzs),
    maxSalaryTzs: numberOrNull(row.max_salary_tzs),
    certificateRequired: toBoolOrNull(row.certificate_required),
    educationLevelMax: (textOrNull(row.education_level_max) as EducationLevel | null),
    experienceYearsMax: numberOrNull(row.experience_years_max),
    accommodationRequiredOutsideHome: toBool(row.accommodation_required_outside_home),
    employmentTypes: fromJsonArray<EmploymentType>(row.employment_types_json),
    workModes: fromJsonArray<WorkMode>(row.work_modes_json),
    willingToRelocate: toBool(row.willing_to_relocate),
    genderNeutralOnly: toBool(row.gender_neutral_only),
    immediateStartOnly: toBool(row.immediate_start_only),
    updatedAt: String(row.updated_at),
  };
}

function mapPackage(row: Row): MembershipPackage {
  const categories = textOrNull(row.categories_json);
  return {
    code: String(row.code),
    name: String(row.name),
    priceTzs: Number(row.price_tzs),
    durationDays: Number(row.duration_days),
    coversNonCertificateJobs: toBool(row.covers_non_certificate_jobs),
    coversCertificateJobs: toBool(row.covers_certificate_jobs),
    applicationLimit: numberOrNull(row.application_limit),
    categories: categories === null ? null : fromJsonArray<JobCategory>(categories),
    priorityReview: toBool(row.priority_review),
    active: toBool(row.active),
  };
}

function mapMembership(row: Row): Membership {
  return {
    id: String(row.id),
    applicantId: String(row.applicant_id),
    packageCode: String(row.package_code),
    status: String(row.status) as MembershipStatus,
    paidAmountTzs: numberOrNull(row.paid_amount_tzs),
    paymentReference: textOrNull(row.payment_reference),
    activatedAt: textOrNull(row.activated_at),
    expiresAt: textOrNull(row.expires_at),
    applicationsUsed: Number(row.applications_used),
    createdAt: String(row.created_at),
  };
}

function mapApplication(row: Row): Application {
  return {
    id: String(row.id),
    reference: String(row.reference),
    vacancyId: String(row.vacancy_id),
    applicantId: String(row.applicant_id),
    cvId: String(row.cv_id),
    employerId: String(row.employer_id),
    status: String(row.status) as ApplicationStatus,
    matchScore: Number(row.match_score),
    employerNotes: textOrNull(row.employer_notes),
    interviewAt: textOrNull(row.interview_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapApplicationEvent(row: Row): ApplicationEvent {
  return {
    id: Number(row.id),
    applicationId: String(row.application_id),
    fromStatus: textOrNull(row.from_status) as ApplicationStatus | null,
    toStatus: String(row.to_status) as ApplicationStatus,
    actorKind: String(row.actor_kind) as Actor['kind'],
    actorId: String(row.actor_id),
    note: textOrNull(row.note),
    createdAt: String(row.created_at),
  };
}

function mapGrant(row: Row): EmployerAccessGrant {
  return {
    id: String(row.id),
    employerId: String(row.employer_id),
    kind: String(row.kind) as AccessGrantKind,
    secretHash: String(row.secret_hash),
    destination: textOrNull(row.destination),
    expiresAt: textOrNull(row.expires_at),
    usedAt: textOrNull(row.used_at),
    attempts: Number(row.attempts),
    createdAt: String(row.created_at),
  };
}

function mapDraft(row: Row): VacancyDraft {
  return {
    id: String(row.id),
    employerId: textOrNull(row.employer_id),
    employerNameGuess: textOrNull(row.employer_name_guess),
    intakeChannel: String(row.intake_channel) as IntakeChannel,
    rawText: textOrNull(row.raw_text),
    sourceImagePath: textOrNull(row.source_image_path),
    extraction: JSON.parse(String(row.extraction_json)) as ExtractionResult,
    overrides: row.overrides_json === null || row.overrides_json === undefined
      ? null
      : (JSON.parse(String(row.overrides_json)) as Record<string, unknown>),
    status: String(row.status) as DraftStatus,
    vacancyId: textOrNull(row.vacancy_id),
    createdBy: textOrNull(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/**
 * All SQL lives here. Services above this layer work in domain types only,
 * which is what lets the employer scoping rule ("an employer sees only its own
 * applicants") be enforced in one place: every employer-facing read takes an
 * employerId and filters on it.
 */
export class Store {
  readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  // ---------------------------------------------------------------- packages

  listPackages(): MembershipPackage[] {
    return (this.db.prepare('SELECT * FROM membership_packages ORDER BY price_tzs').all() as Row[]).map(mapPackage);
  }

  getPackage(code: string): MembershipPackage | null {
    const row = this.db.prepare('SELECT * FROM membership_packages WHERE code = ?').get(code) as Row | undefined;
    return row ? mapPackage(row) : null;
  }

  upsertPackage(pkg: MembershipPackage): void {
    this.db
      .prepare(
        `INSERT INTO membership_packages
           (code, name, price_tzs, duration_days, covers_non_certificate_jobs, covers_certificate_jobs,
            application_limit, categories_json, priority_review, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET
           name = excluded.name,
           price_tzs = excluded.price_tzs,
           duration_days = excluded.duration_days,
           covers_non_certificate_jobs = excluded.covers_non_certificate_jobs,
           covers_certificate_jobs = excluded.covers_certificate_jobs,
           application_limit = excluded.application_limit,
           categories_json = excluded.categories_json,
           priority_review = excluded.priority_review,
           active = excluded.active`,
      )
      .run(
        pkg.code,
        pkg.name,
        pkg.priceTzs,
        pkg.durationDays,
        toInt(pkg.coversNonCertificateJobs) ?? 0,
        toInt(pkg.coversCertificateJobs) ?? 0,
        pkg.applicationLimit,
        pkg.categories === null ? null : toJson(pkg.categories),
        toInt(pkg.priorityReview) ?? 0,
        toInt(pkg.active) ?? 1,
      );
  }

  // --------------------------------------------------------------- employers

  createEmployer(input: {
    name: string;
    slug: string;
    industry?: string | null;
    location?: string | null;
    contactName?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    portalUrl?: string | null;
  }): Employer {
    const id = newId('emp');
    const createdAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO employers (id, name, slug, industry, location, contact_name, contact_phone, contact_email,
                                portal_url, portal_created_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.slug,
        input.industry ?? null,
        input.location ?? null,
        input.contactName ?? null,
        input.contactPhone ?? null,
        input.contactEmail ?? null,
        input.portalUrl ?? null,
        input.portalUrl ? createdAt : null,
        createdAt,
      );
    const employer = this.getEmployer(id);
    if (employer === null) throw new Error('employer insert failed');
    return employer;
  }

  getEmployer(id: string): Employer | null {
    const row = this.db.prepare('SELECT * FROM employers WHERE id = ?').get(id) as Row | undefined;
    return row ? mapEmployer(row) : null;
  }

  getEmployerBySlug(slug: string): Employer | null {
    const row = this.db.prepare('SELECT * FROM employers WHERE slug = ?').get(slug) as Row | undefined;
    return row ? mapEmployer(row) : null;
  }

  findEmployerByName(name: string): Employer | null {
    const row = this.db
      .prepare('SELECT * FROM employers WHERE lower(name) = lower(?)')
      .get(name.trim()) as Row | undefined;
    return row ? mapEmployer(row) : null;
  }

  listEmployers(): Employer[] {
    return (this.db.prepare('SELECT * FROM employers ORDER BY name').all() as Row[]).map(mapEmployer);
  }

  getPortalUrl(employerId: string): string | null {
    const row = this.db.prepare('SELECT portal_url FROM employers WHERE id = ?').get(employerId) as Row | undefined;
    return row ? textOrNull(row.portal_url) : null;
  }

  setPortalUrl(employerId: string, url: string): void {
    this.db
      .prepare('UPDATE employers SET portal_url = ?, portal_created_at = COALESCE(portal_created_at, ?) WHERE id = ?')
      .run(url, nowIso(), employerId);
  }

  markEmployerSeen(employerId: string): void {
    this.db.prepare('UPDATE employers SET last_seen_at = ? WHERE id = ?').run(nowIso(), employerId);
  }

  employerLastSeen(employerId: string): string | null {
    const row = this.db.prepare('SELECT last_seen_at FROM employers WHERE id = ?').get(employerId) as Row | undefined;
    return row ? textOrNull(row.last_seen_at) : null;
  }

  slugTaken(slug: string): boolean {
    const row = this.db.prepare('SELECT 1 AS hit FROM employers WHERE slug = ?').get(slug) as Row | undefined;
    return row !== undefined;
  }

  // ------------------------------------------------------------ employer access

  createAccessGrant(input: {
    employerId: string;
    kind: AccessGrantKind;
    secretHash: string;
    destination?: string | null;
    expiresAt?: string | null;
  }): EmployerAccessGrant {
    const id = newId('grant');
    this.db
      .prepare(
        `INSERT INTO employer_access_grants (id, employer_id, kind, secret_hash, destination, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.employerId, input.kind, input.secretHash, input.destination ?? null, input.expiresAt ?? null, nowIso());
    const row = this.db.prepare('SELECT * FROM employer_access_grants WHERE id = ?').get(id) as Row;
    return mapGrant(row);
  }

  /** Live grants of a kind, newest first. Used grants and expired ones are skipped. */
  listUsableGrants(employerId: string, kind: AccessGrantKind, now: string = nowIso()): EmployerAccessGrant[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM employer_access_grants
         WHERE employer_id = ? AND kind = ? AND used_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY created_at DESC`,
      )
      .all(employerId, kind, now) as Row[];
    return rows.map(mapGrant);
  }

  getGrant(id: string): EmployerAccessGrant | null {
    const row = this.db.prepare('SELECT * FROM employer_access_grants WHERE id = ?').get(id) as Row | undefined;
    return row ? mapGrant(row) : null;
  }

  markGrantUsed(id: string): void {
    this.db.prepare('UPDATE employer_access_grants SET used_at = ? WHERE id = ?').run(nowIso(), id);
  }

  bumpGrantAttempts(id: string): number {
    const row = this.db
      .prepare('UPDATE employer_access_grants SET attempts = attempts + 1 WHERE id = ? RETURNING attempts')
      .get(id) as Row | undefined;
    return row ? Number(row.attempts) : 0;
  }

  revokeGrants(employerId: string, kind: AccessGrantKind): void {
    this.db
      .prepare('UPDATE employer_access_grants SET used_at = ? WHERE employer_id = ? AND kind = ? AND used_at IS NULL')
      .run(nowIso(), employerId, kind);
  }

  createSession(tokenHash: string, employerId: string, expiresAt: string): void {
    this.db
      .prepare('INSERT INTO employer_sessions (token_hash, employer_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash, employerId, expiresAt, nowIso());
  }

  getSessionEmployerId(tokenHash: string, now: string = nowIso()): string | null {
    const row = this.db
      .prepare('SELECT employer_id FROM employer_sessions WHERE token_hash = ? AND expires_at > ?')
      .get(tokenHash, now) as Row | undefined;
    return row ? String(row.employer_id) : null;
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare('DELETE FROM employer_sessions WHERE token_hash = ?').run(tokenHash);
  }

  purgeExpiredSessions(now: string = nowIso()): void {
    this.db.prepare('DELETE FROM employer_sessions WHERE expires_at <= ?').run(now);
    this.db.prepare('DELETE FROM applicant_sessions WHERE expires_at <= ?').run(now);
  }

  createApplicantSession(tokenHash: string, applicantId: string, expiresAt: string): void {
    this.db
      .prepare('INSERT INTO applicant_sessions (token_hash, applicant_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash, applicantId, expiresAt, nowIso());
  }

  getSessionApplicantId(tokenHash: string, now: string = nowIso()): string | null {
    const row = this.db
      .prepare('SELECT applicant_id FROM applicant_sessions WHERE token_hash = ? AND expires_at > ?')
      .get(tokenHash, now) as Row | undefined;
    return row ? String(row.applicant_id) : null;
  }

  deleteApplicantSession(tokenHash: string): void {
    this.db.prepare('DELETE FROM applicant_sessions WHERE token_hash = ?').run(tokenHash);
  }

  // ------------------------------------------------------------------ drafts

  createDraft(input: {
    employerId: string | null;
    employerNameGuess: string | null;
    intakeChannel: IntakeChannel;
    rawText: string | null;
    sourceImagePath: string | null;
    extraction: ExtractionResult;
    createdBy: string | null;
  }): VacancyDraft {
    const id = newId('draft');
    const at = nowIso();
    this.db
      .prepare(
        `INSERT INTO vacancy_drafts
           (id, employer_id, employer_name_guess, intake_channel, raw_text, source_image_path,
            extraction_json, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'extracted', ?, ?, ?)`,
      )
      .run(
        id,
        input.employerId,
        input.employerNameGuess,
        input.intakeChannel,
        input.rawText,
        input.sourceImagePath,
        toJson(input.extraction),
        input.createdBy,
        at,
        at,
      );
    const draft = this.getDraft(id);
    if (draft === null) throw new Error('draft insert failed');
    return draft;
  }

  getDraft(id: string): VacancyDraft | null {
    const row = this.db.prepare('SELECT * FROM vacancy_drafts WHERE id = ?').get(id) as Row | undefined;
    return row ? mapDraft(row) : null;
  }

  listDrafts(status?: DraftStatus): VacancyDraft[] {
    const rows = status
      ? (this.db.prepare('SELECT * FROM vacancy_drafts WHERE status = ? ORDER BY created_at DESC').all(status) as Row[])
      : (this.db.prepare('SELECT * FROM vacancy_drafts ORDER BY created_at DESC').all() as Row[]);
    return rows.map(mapDraft);
  }

  saveDraftCorrections(id: string, overrides: Record<string, unknown>, employerId: string | null): void {
    this.db
      .prepare(
        `UPDATE vacancy_drafts SET overrides_json = ?, employer_id = COALESCE(?, employer_id),
                                   status = 'reviewed', updated_at = ? WHERE id = ?`,
      )
      .run(toJson(overrides), employerId, nowIso(), id);
  }

  markDraftPublished(id: string, vacancyId: string, employerId: string): void {
    this.db
      .prepare(`UPDATE vacancy_drafts SET status = 'published', vacancy_id = ?, employer_id = ?, updated_at = ? WHERE id = ?`)
      .run(vacancyId, employerId, nowIso(), id);
  }

  discardDraft(id: string): void {
    this.db.prepare(`UPDATE vacancy_drafts SET status = 'discarded', updated_at = ? WHERE id = ?`).run(nowIso(), id);
  }

  // --------------------------------------------------------------- vacancies

  insertVacancy(vacancy: Omit<Vacancy, 'createdAt' | 'updatedAt'>): Vacancy {
    const at = nowIso();
    this.db
      .prepare(
        `INSERT INTO vacancies
           (id, employer_id, agency_ref, slug, status, title, location, category, positions,
            salary_amount_min, salary_amount_max, salary_currency, salary_period, salary_plus_tips, salary_monthly_tzs,
            accommodation_provided, meals_provided, transport_provided, employment_type, work_mode,
            gender_requirement, age_min, age_max, languages_json, experience_years_min, experience_note,
            education_min, certificate_required, immediate_start, start_date, application_deadline,
            description, source_image_path, source_text, intake_channel, published_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        vacancy.id,
        vacancy.employerId,
        vacancy.agencyRef,
        vacancy.slug,
        vacancy.status,
        vacancy.title,
        vacancy.location,
        vacancy.category,
        vacancy.positions,
        vacancy.salary.amountMin,
        vacancy.salary.amountMax,
        vacancy.salary.currency,
        vacancy.salary.period,
        toInt(vacancy.salary.plusTips) ?? 0,
        vacancy.salary.monthlyTzs,
        toInt(vacancy.accommodationProvided) ?? 0,
        toInt(vacancy.mealsProvided) ?? 0,
        toInt(vacancy.transportProvided) ?? 0,
        vacancy.employmentType,
        vacancy.workMode,
        vacancy.genderRequirement,
        vacancy.ageMin,
        vacancy.ageMax,
        toJson(vacancy.languages),
        vacancy.experienceYearsMin,
        vacancy.experienceNote,
        vacancy.educationMin,
        toInt(vacancy.certificateRequired) ?? 0,
        toInt(vacancy.immediateStart) ?? 0,
        vacancy.startDate,
        vacancy.applicationDeadline,
        vacancy.description,
        vacancy.sourceImagePath,
        vacancy.sourceText,
        vacancy.intakeChannel,
        vacancy.publishedAt,
        at,
        at,
      );
    const saved = this.getVacancy(vacancy.id);
    if (saved === null) throw new Error('vacancy insert failed');
    return saved;
  }

  getVacancy(id: string): Vacancy | null {
    const row = this.db.prepare('SELECT * FROM vacancies WHERE id = ?').get(id) as Row | undefined;
    return row ? mapVacancy(row) : null;
  }

  getVacancyBySlug(employerId: string, slug: string): Vacancy | null {
    const row = this.db
      .prepare('SELECT * FROM vacancies WHERE employer_id = ? AND slug = ?')
      .get(employerId, slug) as Row | undefined;
    return row ? mapVacancy(row) : null;
  }

  listPublishedVacancies(): Vacancy[] {
    const rows = this.db
      .prepare(`SELECT * FROM vacancies WHERE status = 'published' ORDER BY published_at DESC`)
      .all() as Row[];
    return rows.map(mapVacancy);
  }

  listVacanciesByEmployer(employerId: string): Vacancy[] {
    const rows = this.db
      .prepare('SELECT * FROM vacancies WHERE employer_id = ? ORDER BY created_at DESC')
      .all(employerId) as Row[];
    return rows.map(mapVacancy);
  }

  setVacancyStatus(id: string, status: VacancyStatus): void {
    const publishedAt = status === 'published' ? nowIso() : null;
    this.db
      .prepare('UPDATE vacancies SET status = ?, published_at = COALESCE(?, published_at), updated_at = ? WHERE id = ?')
      .run(status, publishedAt, nowIso(), id);
  }

  countAgencyRefsForYear(year: number): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS total FROM vacancies WHERE agency_ref LIKE ?`)
      .get(`SH-JOB-${year}-%`) as Row;
    return Number(row.total);
  }

  // -------------------------------------------------------------- applicants

  createApplicant(input: Omit<Applicant, 'id' | 'createdAt'>): Applicant {
    const id = newId('app');
    this.db
      .prepare(
        `INSERT INTO applicants (id, full_name, phone, email, location, gender, date_of_birth, education_level,
                                 languages_json, willing_to_relocate, available_from, soko_huru_verified, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.fullName,
        input.phone,
        input.email,
        input.location,
        input.gender,
        input.dateOfBirth,
        input.educationLevel,
        toJson(input.languages),
        toInt(input.willingToRelocate) ?? 0,
        input.availableFrom,
        toInt(input.sokoHuruVerified) ?? 0,
        nowIso(),
      );
    const applicant = this.getApplicant(id);
    if (applicant === null) throw new Error('applicant insert failed');
    return applicant;
  }

  getApplicant(id: string): Applicant | null {
    const row = this.db.prepare('SELECT * FROM applicants WHERE id = ?').get(id) as Row | undefined;
    return row ? mapApplicant(row) : null;
  }

  getApplicantByPhone(phone: string): Applicant | null {
    const row = this.db.prepare('SELECT * FROM applicants WHERE phone = ?').get(phone) as Row | undefined;
    return row ? mapApplicant(row) : null;
  }

  listApplicants(): Applicant[] {
    return (this.db.prepare('SELECT * FROM applicants ORDER BY created_at DESC').all() as Row[]).map(mapApplicant);
  }

  addCv(input: Omit<Cv, 'id' | 'createdAt'>): Cv {
    const id = newId('cv');
    this.db
      .prepare(
        `INSERT INTO cvs (id, applicant_id, label, categories_json, headline, experience_years, education_level,
                          skills_json, languages_json, certificates_json, preferred_salary_tzs, file_path, is_default, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.applicantId,
        input.label,
        toJson(input.categories),
        input.headline,
        input.experienceYears,
        input.educationLevel,
        toJson(input.skills),
        toJson(input.languages),
        toJson(input.certificates),
        input.preferredSalaryTzs,
        input.filePath,
        toInt(input.isDefault) ?? 0,
        nowIso(),
      );
    const cv = this.getCv(id);
    if (cv === null) throw new Error('cv insert failed');
    return cv;
  }

  getCv(id: string): Cv | null {
    const row = this.db.prepare('SELECT * FROM cvs WHERE id = ?').get(id) as Row | undefined;
    return row ? mapCv(row) : null;
  }

  listCvs(applicantId: string): Cv[] {
    const rows = this.db
      .prepare('SELECT * FROM cvs WHERE applicant_id = ? ORDER BY is_default DESC, created_at DESC')
      .all(applicantId) as Row[];
    return rows.map(mapCv);
  }

  getPreferences(applicantId: string): ApplicantPreferences | null {
    const row = this.db
      .prepare('SELECT * FROM applicant_preferences WHERE applicant_id = ?')
      .get(applicantId) as Row | undefined;
    return row ? mapPreferences(row) : null;
  }

  savePreferences(preferences: Omit<ApplicantPreferences, 'updatedAt'>): ApplicantPreferences {
    this.db
      .prepare(
        `INSERT INTO applicant_preferences
           (applicant_id, locations_json, categories_json, min_salary_tzs, max_salary_tzs, certificate_required,
            education_level_max, experience_years_max, accommodation_required_outside_home, employment_types_json,
            work_modes_json, willing_to_relocate, gender_neutral_only, immediate_start_only, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(applicant_id) DO UPDATE SET
           locations_json = excluded.locations_json,
           categories_json = excluded.categories_json,
           min_salary_tzs = excluded.min_salary_tzs,
           max_salary_tzs = excluded.max_salary_tzs,
           certificate_required = excluded.certificate_required,
           education_level_max = excluded.education_level_max,
           experience_years_max = excluded.experience_years_max,
           accommodation_required_outside_home = excluded.accommodation_required_outside_home,
           employment_types_json = excluded.employment_types_json,
           work_modes_json = excluded.work_modes_json,
           willing_to_relocate = excluded.willing_to_relocate,
           gender_neutral_only = excluded.gender_neutral_only,
           immediate_start_only = excluded.immediate_start_only,
           updated_at = excluded.updated_at`,
      )
      .run(
        preferences.applicantId,
        toJson(preferences.locations),
        toJson(preferences.categories),
        preferences.minSalaryTzs,
        preferences.maxSalaryTzs,
        toInt(preferences.certificateRequired),
        preferences.educationLevelMax,
        preferences.experienceYearsMax,
        toInt(preferences.accommodationRequiredOutsideHome) ?? 0,
        toJson(preferences.employmentTypes),
        toJson(preferences.workModes),
        toInt(preferences.willingToRelocate) ?? 0,
        toInt(preferences.genderNeutralOnly) ?? 0,
        toInt(preferences.immediateStartOnly) ?? 0,
        nowIso(),
      );
    const saved = this.getPreferences(preferences.applicantId);
    if (saved === null) throw new Error('preferences save failed');
    return saved;
  }

  // ------------------------------------------------------------- memberships

  createMembership(input: {
    applicantId: string;
    packageCode: string;
    status?: MembershipStatus;
    paidAmountTzs?: number | null;
    paymentReference?: string | null;
    activatedAt?: string | null;
    expiresAt?: string | null;
  }): Membership {
    const id = newId('mem');
    this.db
      .prepare(
        `INSERT INTO memberships (id, applicant_id, package_code, status, paid_amount_tzs, payment_reference,
                                  activated_at, expires_at, applications_used, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(
        id,
        input.applicantId,
        input.packageCode,
        input.status ?? 'pending_payment',
        input.paidAmountTzs ?? null,
        input.paymentReference ?? null,
        input.activatedAt ?? null,
        input.expiresAt ?? null,
        nowIso(),
      );
    const membership = this.getMembership(id);
    if (membership === null) throw new Error('membership insert failed');
    return membership;
  }

  getMembership(id: string): Membership | null {
    const row = this.db.prepare('SELECT * FROM memberships WHERE id = ?').get(id) as Row | undefined;
    return row ? mapMembership(row) : null;
  }

  /** The membership KobeOS checks on a right swipe: active and unexpired. */
  getActiveMembership(applicantId: string, now: string = nowIso()): Membership | null {
    const row = this.db
      .prepare(
        `SELECT * FROM memberships
         WHERE applicant_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY expires_at DESC LIMIT 1`,
      )
      .get(applicantId, now) as Row | undefined;
    return row ? mapMembership(row) : null;
  }

  /** Latest membership of any status, used to explain why an applicant is blocked. */
  getLatestMembership(applicantId: string): Membership | null {
    const row = this.db
      .prepare('SELECT * FROM memberships WHERE applicant_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(applicantId) as Row | undefined;
    return row ? mapMembership(row) : null;
  }

  activateMembership(id: string, paidAmountTzs: number, paymentReference: string, expiresAt: string): Membership {
    this.db
      .prepare(
        `UPDATE memberships SET status = 'active', paid_amount_tzs = ?, payment_reference = ?,
                                activated_at = ?, expires_at = ? WHERE id = ?`,
      )
      .run(paidAmountTzs, paymentReference, nowIso(), expiresAt, id);
    const membership = this.getMembership(id);
    if (membership === null) throw new Error('membership not found');
    return membership;
  }

  incrementApplicationsUsed(id: string): void {
    this.db.prepare('UPDATE memberships SET applications_used = applications_used + 1 WHERE id = ?').run(id);
  }

  expireLapsedMemberships(now: string = nowIso()): number {
    const result = this.db
      .prepare(`UPDATE memberships SET status = 'expired' WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?`)
      .run(now);
    return Number(result.changes);
  }

  listMembershipsExpiringWithin(days: number, now: Date = new Date()): Membership[] {
    const limit = new Date(now.getTime() + days * 86_400_000).toISOString();
    const rows = this.db
      .prepare(
        `SELECT * FROM memberships WHERE status = 'active' AND expires_at IS NOT NULL
           AND expires_at > ? AND expires_at <= ? ORDER BY expires_at`,
      )
      .all(now.toISOString(), limit) as Row[];
    return rows.map(mapMembership);
  }

  // ------------------------------------------------------------ applications

  /** Allocates the next SH-YYYY-NNNNNN number for the year. */
  nextApplicationReference(year: number = new Date().getUTCFullYear()): string {
    const row = this.db
      .prepare(
        `INSERT INTO reference_counters (year, next_value) VALUES (?, 1)
         ON CONFLICT(year) DO UPDATE SET next_value = next_value + 1
         RETURNING next_value`,
      )
      .get(year) as Row;
    return formatApplicationReference(APPLICATION_REFERENCE_PREFIX, year, Number(row.next_value));
  }

  createApplication(input: {
    reference: string;
    vacancyId: string;
    applicantId: string;
    cvId: string;
    employerId: string;
    matchScore: number;
  }): Application {
    const id = newId('apl');
    const at = nowIso();
    this.db
      .prepare(
        `INSERT INTO applications (id, reference, vacancy_id, applicant_id, cv_id, employer_id, status,
                                   match_score, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'applied', ?, ?, ?)`,
      )
      .run(id, input.reference, input.vacancyId, input.applicantId, input.cvId, input.employerId, input.matchScore, at, at);
    this.addApplicationEvent(id, null, 'applied', { kind: 'applicant', id: input.applicantId }, null);
    const application = this.getApplication(id);
    if (application === null) throw new Error('application insert failed');
    return application;
  }

  getApplication(id: string): Application | null {
    const row = this.db.prepare('SELECT * FROM applications WHERE id = ?').get(id) as Row | undefined;
    return row ? mapApplication(row) : null;
  }

  getApplicationByReference(reference: string): Application | null {
    const row = this.db.prepare('SELECT * FROM applications WHERE reference = ?').get(reference) as Row | undefined;
    return row ? mapApplication(row) : null;
  }

  findApplication(vacancyId: string, applicantId: string): Application | null {
    const row = this.db
      .prepare('SELECT * FROM applications WHERE vacancy_id = ? AND applicant_id = ?')
      .get(vacancyId, applicantId) as Row | undefined;
    return row ? mapApplication(row) : null;
  }

  listApplicationsForApplicant(applicantId: string): Application[] {
    const rows = this.db
      .prepare('SELECT * FROM applications WHERE applicant_id = ? ORDER BY created_at DESC')
      .all(applicantId) as Row[];
    return rows.map(mapApplication);
  }

  countHired(vacancyId: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS total FROM applications WHERE vacancy_id = ? AND status = 'hired'`)
      .get(vacancyId) as Row;
    return Number(row.total);
  }

  hiredCountsByVacancy(): Map<string, number> {
    const rows = this.db
      .prepare(`SELECT vacancy_id, COUNT(*) AS total FROM applications WHERE status = 'hired' GROUP BY vacancy_id`)
      .all() as Row[];
    return new Map(rows.map((row) => [String(row.vacancy_id), Number(row.total)]));
  }

  updateApplicationStatus(id: string, status: ApplicationStatus): void {
    this.db.prepare('UPDATE applications SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), id);
  }

  setApplicationNotes(id: string, notes: string | null): void {
    this.db.prepare('UPDATE applications SET employer_notes = ?, updated_at = ? WHERE id = ?').run(notes, nowIso(), id);
  }

  setInterviewAt(id: string, interviewAt: string | null): void {
    this.db.prepare('UPDATE applications SET interview_at = ?, updated_at = ? WHERE id = ?').run(interviewAt, nowIso(), id);
  }

  addApplicationEvent(
    applicationId: string,
    fromStatus: ApplicationStatus | null,
    toStatus: ApplicationStatus,
    actor: Actor,
    note: string | null,
  ): void {
    this.db
      .prepare(
        `INSERT INTO application_events (application_id, from_status, to_status, actor_kind, actor_id, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(applicationId, fromStatus, toStatus, actor.kind, actor.id, note, nowIso());
  }

  listApplicationEvents(applicationId: string): ApplicationEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM application_events WHERE application_id = ? ORDER BY id')
      .all(applicationId) as Row[];
    return rows.map(mapApplicationEvent);
  }

  /**
   * The employer's applicant list. `employerId` is always part of the WHERE
   * clause - this is the single place that guarantees an employer only ever
   * sees candidates who applied to its own vacancies.
   */
  listApplicationsForEmployer(employerId: string, filters: EmployerApplicationFilters = {}): ApplicationDetail[] {
    const clauses = ['a.employer_id = ?'];
    const params: (string | number)[] = [employerId];

    if (filters.applicationId) {
      clauses.push('a.id = ?');
      params.push(filters.applicationId);
    }
    if (filters.vacancyId) {
      clauses.push('a.vacancy_id = ?');
      params.push(filters.vacancyId);
    }
    if (filters.status) {
      clauses.push('a.status = ?');
      params.push(filters.status);
    }
    if (filters.location) {
      clauses.push('lower(p.location) LIKE ?');
      params.push(`%${filters.location.toLowerCase()}%`);
    }
    if (typeof filters.minExperienceYears === 'number') {
      clauses.push('c.experience_years >= ?');
      params.push(filters.minExperienceYears);
    }
    if (filters.education) {
      clauses.push('c.education_level = ?');
      params.push(filters.education);
    }
    if (filters.language) {
      clauses.push('lower(c.languages_json) LIKE ?');
      params.push(`%${filters.language.toLowerCase()}%`);
    }
    if (filters.availableNow) {
      clauses.push("(p.available_from IS NULL OR p.available_from <= ?)");
      params.push(nowIso());
    }
    if (filters.search) {
      clauses.push('(lower(p.full_name) LIKE ? OR lower(c.headline) LIKE ? OR lower(c.skills_json) LIKE ? OR a.reference LIKE ?)');
      const needle = `%${filters.search.toLowerCase()}%`;
      params.push(needle, needle, needle, `%${filters.search.toUpperCase()}%`);
    }

    const limit = Math.min(filters.limit ?? 100, 500);
    const offset = filters.offset ?? 0;

    const rows = this.db
      .prepare(
        `SELECT a.*,
                p.id AS p_id, p.full_name, p.phone, p.email, p.location, p.gender, p.date_of_birth,
                p.education_level AS p_education_level, p.languages_json AS p_languages_json,
                p.willing_to_relocate, p.available_from, p.soko_huru_verified, p.created_at AS p_created_at,
                c.id AS c_id, c.label, c.categories_json, c.headline, c.experience_years,
                c.education_level AS c_education_level, c.skills_json, c.languages_json AS c_languages_json,
                c.certificates_json, c.preferred_salary_tzs, c.file_path, c.is_default, c.created_at AS c_created_at,
                v.title AS v_title, v.location AS v_location
         FROM applications a
         JOIN applicants p ON p.id = a.applicant_id
         JOIN cvs c ON c.id = a.cv_id
         JOIN vacancies v ON v.id = a.vacancy_id
         WHERE ${clauses.join(' AND ')}
         ORDER BY a.match_score DESC, a.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as Row[];

    return rows.map((row) => ({
      application: mapApplication(row),
      applicant: mapApplicant({
        id: row.p_id,
        full_name: row.full_name,
        phone: row.phone,
        email: row.email,
        location: row.location,
        gender: row.gender,
        date_of_birth: row.date_of_birth,
        education_level: row.p_education_level,
        languages_json: row.p_languages_json,
        willing_to_relocate: row.willing_to_relocate,
        available_from: row.available_from,
        soko_huru_verified: row.soko_huru_verified,
        created_at: row.p_created_at,
      }),
      cv: mapCv({
        id: row.c_id,
        applicant_id: row.p_id,
        label: row.label,
        categories_json: row.categories_json,
        headline: row.headline,
        experience_years: row.experience_years,
        education_level: row.c_education_level,
        skills_json: row.skills_json,
        languages_json: row.c_languages_json,
        certificates_json: row.certificates_json,
        preferred_salary_tzs: row.preferred_salary_tzs,
        file_path: row.file_path,
        is_default: row.is_default,
        created_at: row.c_created_at,
      }),
      vacancyTitle: String(row.v_title),
      vacancyLocation: String(row.v_location),
    }));
  }

  // ------------------------------------------------------------------ swipes

  recordSwipe(applicantId: string, vacancyId: string, direction: SwipeDirection): void {
    this.db
      .prepare(
        `INSERT INTO swipes (id, applicant_id, vacancy_id, direction, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(applicant_id, vacancy_id) DO UPDATE SET direction = excluded.direction, created_at = excluded.created_at`,
      )
      .run(newId('swp'), applicantId, vacancyId, direction, nowIso());
  }

  /** Vacancies already skipped or applied to, so they never come back in the deck. */
  listResolvedVacancyIds(applicantId: string): Set<string> {
    const rows = this.db
      .prepare(`SELECT vacancy_id FROM swipes WHERE applicant_id = ? AND direction IN ('left', 'right')`)
      .all(applicantId) as Row[];
    return new Set(rows.map((row) => String(row.vacancy_id)));
  }

  listSavedVacancyIds(applicantId: string): string[] {
    const rows = this.db
      .prepare(`SELECT vacancy_id FROM swipes WHERE applicant_id = ? AND direction = 'up' ORDER BY created_at DESC`)
      .all(applicantId) as Row[];
    return rows.map((row) => String(row.vacancy_id));
  }

  // ---------------------------------------------------------------- realtime

  appendEvent(scope: RealtimeScope, scopeId: string, type: string, payload: unknown): StoredEvent {
    const row = this.db
      .prepare(
        `INSERT INTO realtime_events (scope, scope_id, type, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?) RETURNING id, created_at`,
      )
      .get(scope, scopeId, type, toJson(payload), nowIso()) as Row;
    return { id: Number(row.id), scope, scopeId, type, payload, createdAt: String(row.created_at) };
  }

  listEventsSince(scope: RealtimeScope, scopeId: string, sinceId: number, limit = 100): StoredEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM realtime_events WHERE scope = ? AND scope_id = ? AND id > ? ORDER BY id LIMIT ?`,
      )
      .all(scope, scopeId, sinceId, limit) as Row[];
    return rows.map((row) => ({
      id: Number(row.id),
      scope: String(row.scope) as RealtimeScope,
      scopeId: String(row.scope_id),
      type: String(row.type),
      payload: JSON.parse(String(row.payload_json)) as unknown,
      createdAt: String(row.created_at),
    }));
  }

  // ------------------------------------------------------------------- stats

  /**
   * Counters for the employer dashboard. "Viewed", "Shortlisted" and the
   * interview tiles count every application that ever reached that stage, so a
   * candidate who has moved on still counts on the earlier tile.
   */
  vacancyStats(vacancyId: string): VacancyStats | null {
    const vacancy = this.getVacancy(vacancyId);
    if (vacancy === null) return null;
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) AS applications,
           SUM(CASE WHEN a.status = 'applied' THEN 1 ELSE 0 END) AS new_applications,
           SUM(CASE WHEN a.status = 'hired' THEN 1 ELSE 0 END) AS hired,
           SUM(CASE WHEN a.status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
           SUM(CASE WHEN EXISTS (SELECT 1 FROM application_events e WHERE e.application_id = a.id AND e.to_status = 'viewed') THEN 1 ELSE 0 END) AS viewed,
           SUM(CASE WHEN EXISTS (SELECT 1 FROM application_events e WHERE e.application_id = a.id AND e.to_status = 'shortlisted') THEN 1 ELSE 0 END) AS shortlisted,
           SUM(CASE WHEN EXISTS (SELECT 1 FROM application_events e WHERE e.application_id = a.id AND e.to_status = 'interview_invited') THEN 1 ELSE 0 END) AS interview_invited,
           SUM(CASE WHEN EXISTS (SELECT 1 FROM application_events e WHERE e.application_id = a.id AND e.to_status = 'interview_completed') THEN 1 ELSE 0 END) AS interview_completed
         FROM applications a WHERE a.vacancy_id = ?`,
      )
      .get(vacancyId) as Row;

    const hired = Number(row.hired ?? 0);
    return {
      vacancyId,
      title: vacancy.title,
      location: vacancy.location,
      positions: vacancy.positions,
      applications: Number(row.applications ?? 0),
      newApplications: Number(row.new_applications ?? 0),
      viewed: Number(row.viewed ?? 0),
      shortlisted: Number(row.shortlisted ?? 0),
      interviewInvited: Number(row.interview_invited ?? 0),
      interviewCompleted: Number(row.interview_completed ?? 0),
      rejected: Number(row.rejected ?? 0),
      hired,
      remainingPositions: Math.max(0, vacancy.positions - hired),
    };
  }

  employerStats(employerId: string): VacancyStats[] {
    return this.listVacanciesByEmployer(employerId)
      .map((vacancy) => this.vacancyStats(vacancy.id))
      .filter((stats): stats is VacancyStats => stats !== null);
  }

  /** The Soko Huru control dashboard: every client, every vacancy, live counts. */
  agencyOverview(): AgencyOverviewRow[] {
    const rows = this.db
      .prepare(
        `SELECT v.id AS vacancy_id, v.title, e.id AS employer_id, e.name AS employer_name, e.last_seen_at,
                v.positions,
                (SELECT COUNT(*) FROM applications a WHERE a.vacancy_id = v.id) AS applications,
                (SELECT COUNT(*) FROM applications a WHERE a.vacancy_id = v.id AND a.status = 'applied') AS new_applications,
                (SELECT COUNT(*) FROM applications a WHERE a.vacancy_id = v.id AND a.status = 'hired') AS hired
         FROM vacancies v
         JOIN employers e ON e.id = v.employer_id
         WHERE v.status IN ('published', 'paused', 'filled')
         ORDER BY applications DESC, v.created_at DESC`,
      )
      .all() as Row[];

    return rows.map((row) => {
      const hired = Number(row.hired);
      return {
        employerId: String(row.employer_id),
        employerName: String(row.employer_name),
        vacancyId: String(row.vacancy_id),
        jobTitle: String(row.title),
        applications: Number(row.applications),
        newApplications: Number(row.new_applications),
        hired,
        remainingPositions: Math.max(0, Number(row.positions) - hired),
        employerLastSeenAt: textOrNull(row.last_seen_at),
        unreviewedApplications: Number(row.new_applications),
      };
    });
  }
}
