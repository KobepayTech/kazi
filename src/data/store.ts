import type { DatabaseSync } from 'node:sqlite';
import { APPLICATION_REFERENCE_PREFIX } from '../config.ts';
import { formatApplicationReference, formatJobReference, newId } from '../domain/ids.ts';
import { withMonthlyTzs } from '../domain/salary.ts';
import type {
  Actor,
  Applicant,
  ApplicantPreferences,
  Application,
  ApplicationStatus,
  ApplicationStatusChange,
  Currency,
  Cv,
  EducationLevel,
  Employer,
  ExtractionResult,
  IntakeChannel,
  Job,
  JobCategory,
  JobStats,
  JobStatus,
  Membership,
  MembershipPlan,
  MembershipStatus,
  Payment,
  PaymentStatus,
  SalaryPeriod,
  SwipeDirection,
  Tenant,
  AgencyOverviewRow,
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

export type JobDraft = {
  id: string;
  tenantId: string;
  employerId: string | null;
  employerNameGuess: string | null;
  intakeChannel: IntakeChannel;
  rawText: string | null;
  sourceImagePath: string | null;
  extraction: ExtractionResult;
  overrides: Record<string, unknown> | null;
  status: DraftStatus;
  jobId: string | null;
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

export type SessionSubject = { tenantId: string; kind: 'applicant' | 'employer'; id: string };

export type ApplicationFilters = {
  applicationId?: string;
  jobId?: string;
  status?: ApplicationStatus;
  location?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

/** An application joined with the applicant and CV the employer card renders. */
export type ApplicationDetail = {
  application: Application;
  applicant: Applicant;
  cv: Cv;
  jobTitle: string;
  jobLocation: string;
};

// ------------------------------------------------------------------ mappers

function mapTenant(row: Row): Tenant {
  return { id: String(row.id), name: String(row.name), slug: String(row.slug), createdAt: String(row.created_at) };
}

function mapEmployer(row: Row): Employer {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    accessCode: String(row.access_code),
    contactName: textOrNull(row.contact_name),
    contactPhone: textOrNull(row.contact_phone),
    contactEmail: textOrNull(row.contact_email),
    lastSeenAt: textOrNull(row.last_seen_at),
    createdAt: String(row.created_at),
  };
}

function mapJob(row: Row): Job {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    employerId: String(row.employer_id),
    reference: String(row.reference),
    status: String(row.status) as JobStatus,
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
    description: textOrNull(row.description),
    responsibilities: fromJsonArray<string>(row.responsibilities_json),
    requirements: fromJsonArray<string>(row.requirements_json),
    applicationDeadline: textOrNull(row.application_deadline),
    contactInfo: textOrNull(row.contact_info),
    accommodationProvided: toBool(row.accommodation_provided),
    languages: fromJsonArray<string>(row.languages_json),
    experienceNote: textOrNull(row.experience_note),
    certificateRequired: toBool(row.certificate_required),
    immediateStart: toBool(row.immediate_start),
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
    tenantId: String(row.tenant_id),
    fullName: String(row.full_name),
    phone: String(row.phone),
    email: textOrNull(row.email),
    location: String(row.location),
    educationLevel: String(row.education_level) as EducationLevel,
    experienceYears: Number(row.experience_years),
    skills: fromJsonArray<string>(row.skills_json),
    languages: fromJsonArray<string>(row.languages_json),
    photoPath: textOrNull(row.photo_path),
    willingToRelocate: toBool(row.willing_to_relocate),
    createdAt: String(row.created_at),
  };
}

function mapPreferences(row: Row): ApplicantPreferences {
  return {
    applicantId: String(row.applicant_id),
    tenantId: String(row.tenant_id),
    categories: fromJsonArray<JobCategory>(row.categories_json),
    locations: fromJsonArray<string>(row.locations_json),
    minSalaryTzs: numberOrNull(row.min_salary_tzs),
    certificateRequired: toBoolOrNull(row.certificate_required),
    updatedAt: String(row.updated_at),
  };
}

function mapPlan(row: Row): MembershipPlan {
  return {
    tenantId: String(row.tenant_id),
    code: String(row.code),
    name: String(row.name),
    priceTzs: Number(row.price_tzs),
    durationDays: Number(row.duration_days),
    coversNonCertificateJobs: toBool(row.covers_non_certificate_jobs),
    coversCertificateJobs: toBool(row.covers_certificate_jobs),
    active: toBool(row.active),
  };
}

function mapMembership(row: Row): Membership {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    applicantId: String(row.applicant_id),
    planCode: String(row.plan_code),
    status: String(row.status) as MembershipStatus,
    activatedAt: textOrNull(row.activated_at),
    expiresAt: textOrNull(row.expires_at),
    createdAt: String(row.created_at),
  };
}

function mapPayment(row: Row): Payment {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    applicantId: String(row.applicant_id),
    membershipId: String(row.membership_id),
    amountTzs: Number(row.amount_tzs),
    reference: String(row.reference),
    method: String(row.method),
    status: String(row.status) as PaymentStatus,
    note: textOrNull(row.note),
    submittedAt: String(row.submitted_at),
    reviewedAt: textOrNull(row.reviewed_at),
    reviewedBy: textOrNull(row.reviewed_by),
  };
}

function mapApplication(row: Row): Application {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    reference: String(row.reference),
    jobId: String(row.job_id),
    applicantId: String(row.applicant_id),
    cvId: String(row.cv_id),
    employerId: String(row.employer_id),
    status: String(row.status) as ApplicationStatus,
    employerNotes: textOrNull(row.employer_notes),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapHistory(row: Row): ApplicationStatusChange {
  return {
    id: Number(row.id),
    tenantId: String(row.tenant_id),
    applicationId: String(row.application_id),
    fromStatus: textOrNull(row.from_status) as ApplicationStatus | null,
    toStatus: String(row.to_status) as ApplicationStatus,
    actorKind: String(row.actor_kind) as Actor['kind'],
    actorId: String(row.actor_id),
    note: textOrNull(row.note),
    createdAt: String(row.created_at),
  };
}

function mapCv(row: Row): Cv {
  return JSON.parse(String(row.document_json)) as Cv;
}

function mapDraft(row: Row): JobDraft {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    employerId: textOrNull(row.employer_id),
    employerNameGuess: textOrNull(row.employer_name_guess),
    intakeChannel: String(row.intake_channel) as IntakeChannel,
    rawText: textOrNull(row.raw_text),
    sourceImagePath: textOrNull(row.source_image_path),
    extraction: JSON.parse(String(row.extraction_json)) as ExtractionResult,
    overrides:
      row.overrides_json === null || row.overrides_json === undefined
        ? null
        : (JSON.parse(String(row.overrides_json)) as Record<string, unknown>),
    status: String(row.status) as DraftStatus,
    jobId: textOrNull(row.job_id),
    createdBy: textOrNull(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/**
 * Platform-level storage: tenants, sessions and the short-code lookup that
 * turns /e/7HK29D into an employer. Everything else lives on TenantStore.
 */
export class Store {
  readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  forTenant(tenantId: string): TenantStore {
    return new TenantStore(this.db, tenantId);
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

  createTenant(name: string, slug: string, apiKeyHash: string): Tenant {
    const id = newId('ten');
    this.db
      .prepare('INSERT INTO tenants (id, name, slug, api_key_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, slug, apiKeyHash, nowIso());
    const tenant = this.getTenant(id);
    if (tenant === null) throw new Error('tenant insert failed');
    return tenant;
  }

  getTenant(id: string): Tenant | null {
    const row = this.db.prepare('SELECT * FROM tenants WHERE id = ?').get(id) as Row | undefined;
    return row ? mapTenant(row) : null;
  }

  getTenantBySlug(slug: string): Tenant | null {
    const row = this.db.prepare('SELECT * FROM tenants WHERE slug = ?').get(slug) as Row | undefined;
    return row ? mapTenant(row) : null;
  }

  /** Candidate tenants for an API key; the caller compares hashes in constant time. */
  listTenantKeyHashes(): { tenantId: string; apiKeyHash: string }[] {
    const rows = this.db.prepare('SELECT id, api_key_hash FROM tenants').all() as Row[];
    return rows.map((row) => ({ tenantId: String(row.id), apiKeyHash: String(row.api_key_hash) }));
  }

  setTenantApiKey(tenantId: string, apiKeyHash: string): void {
    this.db.prepare('UPDATE tenants SET api_key_hash = ? WHERE id = ?').run(apiKeyHash, tenantId);
  }

  listTenants(): Tenant[] {
    return (this.db.prepare('SELECT * FROM tenants ORDER BY name').all() as Row[]).map(mapTenant);
  }

  /** The /e/<code> lookup. Access codes are unique across the platform. */
  findEmployerByAccessCode(accessCode: string): Employer | null {
    const row = this.db
      .prepare('SELECT * FROM employers WHERE access_code = ?')
      .get(accessCode.toUpperCase()) as Row | undefined;
    return row ? mapEmployer(row) : null;
  }

  accessCodeTaken(accessCode: string): boolean {
    return this.db.prepare('SELECT 1 FROM employers WHERE access_code = ?').get(accessCode) !== undefined;
  }

  createSession(tokenHash: string, subject: SessionSubject, expiresAt: string): void {
    this.db
      .prepare(
        `INSERT INTO sessions (token_hash, tenant_id, subject_kind, subject_id, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(tokenHash, subject.tenantId, subject.kind, subject.id, expiresAt, nowIso());
  }

  getSession(tokenHash: string, now: string = nowIso()): SessionSubject | null {
    const row = this.db
      .prepare('SELECT tenant_id, subject_kind, subject_id FROM sessions WHERE token_hash = ? AND expires_at > ?')
      .get(tokenHash, now) as Row | undefined;
    if (row === undefined) return null;
    return {
      tenantId: String(row.tenant_id),
      kind: String(row.subject_kind) as SessionSubject['kind'],
      id: String(row.subject_id),
    };
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  purgeExpiredSessions(now: string = nowIso()): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  }
}

/**
 * Every query here is filtered by tenant_id, and the employer-facing reads add
 * employer_id on top. That makes tenant isolation and per-client isolation
 * properties of this layer rather than of each caller.
 */
export class TenantStore {
  readonly db: DatabaseSync;
  readonly tenantId: string;

  constructor(db: DatabaseSync, tenantId: string) {
    this.db = db;
    this.tenantId = tenantId;
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

  // ------------------------------------------------------------------ plans

  listPlans(): MembershipPlan[] {
    const rows = this.db
      .prepare('SELECT * FROM membership_plans WHERE tenant_id = ? ORDER BY price_tzs')
      .all(this.tenantId) as Row[];
    return rows.map(mapPlan);
  }

  getPlan(code: string): MembershipPlan | null {
    const row = this.db
      .prepare('SELECT * FROM membership_plans WHERE tenant_id = ? AND code = ?')
      .get(this.tenantId, code) as Row | undefined;
    return row ? mapPlan(row) : null;
  }

  upsertPlan(plan: Omit<MembershipPlan, 'tenantId'>): MembershipPlan {
    this.db
      .prepare(
        `INSERT INTO membership_plans
           (tenant_id, code, name, price_tzs, duration_days, covers_non_certificate_jobs, covers_certificate_jobs, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, code) DO UPDATE SET
           name = excluded.name,
           price_tzs = excluded.price_tzs,
           duration_days = excluded.duration_days,
           covers_non_certificate_jobs = excluded.covers_non_certificate_jobs,
           covers_certificate_jobs = excluded.covers_certificate_jobs,
           active = excluded.active`,
      )
      .run(
        this.tenantId,
        plan.code,
        plan.name,
        plan.priceTzs,
        plan.durationDays,
        toInt(plan.coversNonCertificateJobs) ?? 1,
        toInt(plan.coversCertificateJobs) ?? 0,
        toInt(plan.active) ?? 1,
      );
    const saved = this.getPlan(plan.code);
    if (saved === null) throw new Error('plan upsert failed');
    return saved;
  }

  // ------------------------------------------------------------- applicants

  createApplicant(input: Omit<Applicant, 'id' | 'tenantId' | 'createdAt'>): Applicant {
    const id = newId('apc');
    const at = nowIso();
    this.db
      .prepare('INSERT INTO users (id, tenant_id, role, full_name, phone, email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, this.tenantId, 'applicant', input.fullName, input.phone, input.email, at);
    this.db
      .prepare(
        `INSERT INTO applicant_profiles
           (applicant_id, tenant_id, location, education_level, experience_years, skills_json, languages_json,
            photo_path, willing_to_relocate, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.tenantId,
        input.location,
        input.educationLevel,
        input.experienceYears,
        toJson(input.skills),
        toJson(input.languages),
        input.photoPath,
        toInt(input.willingToRelocate) ?? 0,
        at,
      );
    const applicant = this.getApplicant(id);
    if (applicant === null) throw new Error('applicant insert failed');
    return applicant;
  }

  private applicantQuery(where: string): string {
    return `SELECT u.id, u.tenant_id, u.full_name, u.phone, u.email, u.created_at,
                   p.location, p.education_level, p.experience_years, p.skills_json, p.languages_json,
                   p.photo_path, p.willing_to_relocate
            FROM users u JOIN applicant_profiles p ON p.applicant_id = u.id
            WHERE u.tenant_id = ? AND u.role = 'applicant' AND ${where}`;
  }

  getApplicant(id: string): Applicant | null {
    const row = this.db.prepare(this.applicantQuery('u.id = ?')).get(this.tenantId, id) as Row | undefined;
    return row ? mapApplicant(row) : null;
  }

  getApplicantByPhone(phone: string): Applicant | null {
    const row = this.db.prepare(this.applicantQuery('u.phone = ?')).get(this.tenantId, phone) as Row | undefined;
    return row ? mapApplicant(row) : null;
  }

  listApplicants(): Applicant[] {
    const rows = this.db
      .prepare(`${this.applicantQuery('1 = 1')} ORDER BY u.created_at DESC`)
      .all(this.tenantId) as Row[];
    return rows.map(mapApplicant);
  }

  updateApplicant(id: string, input: Omit<Applicant, 'id' | 'tenantId' | 'createdAt'>): Applicant {
    this.db
      .prepare('UPDATE users SET full_name = ?, phone = ?, email = ? WHERE id = ? AND tenant_id = ?')
      .run(input.fullName, input.phone, input.email, id, this.tenantId);
    this.db
      .prepare(
        `UPDATE applicant_profiles SET location = ?, education_level = ?, experience_years = ?, skills_json = ?,
                languages_json = ?, photo_path = ?, willing_to_relocate = ?
         WHERE applicant_id = ? AND tenant_id = ?`,
      )
      .run(
        input.location,
        input.educationLevel,
        input.experienceYears,
        toJson(input.skills),
        toJson(input.languages),
        input.photoPath,
        toInt(input.willingToRelocate) ?? 0,
        id,
        this.tenantId,
      );
    const applicant = this.getApplicant(id);
    if (applicant === null) throw new Error('applicant not found');
    return applicant;
  }

  getPreferences(applicantId: string): ApplicantPreferences | null {
    const row = this.db
      .prepare('SELECT * FROM applicant_preferences WHERE tenant_id = ? AND applicant_id = ?')
      .get(this.tenantId, applicantId) as Row | undefined;
    return row ? mapPreferences(row) : null;
  }

  savePreferences(preferences: Omit<ApplicantPreferences, 'tenantId' | 'updatedAt'>): ApplicantPreferences {
    this.db
      .prepare(
        `INSERT INTO applicant_preferences
           (applicant_id, tenant_id, categories_json, locations_json, min_salary_tzs, certificate_required, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(applicant_id) DO UPDATE SET
           categories_json = excluded.categories_json,
           locations_json = excluded.locations_json,
           min_salary_tzs = excluded.min_salary_tzs,
           certificate_required = excluded.certificate_required,
           updated_at = excluded.updated_at`,
      )
      .run(
        preferences.applicantId,
        this.tenantId,
        toJson(preferences.categories),
        toJson(preferences.locations),
        preferences.minSalaryTzs,
        toInt(preferences.certificateRequired),
        nowIso(),
      );
    const saved = this.getPreferences(preferences.applicantId);
    if (saved === null) throw new Error('preferences save failed');
    return saved;
  }

  // -------------------------------------------------------------------- cvs

  saveCv(cv: Cv): Cv {
    this.db
      .prepare(
        `INSERT INTO cvs (id, tenant_id, applicant_id, document_json, generated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(applicant_id) DO UPDATE SET document_json = excluded.document_json,
                                                 generated_at = excluded.generated_at`,
      )
      .run(cv.id, this.tenantId, cv.applicantId, toJson(cv), cv.generatedAt);
    const saved = this.getCvByApplicant(cv.applicantId);
    if (saved === null) throw new Error('cv save failed');
    return saved;
  }

  getCvByApplicant(applicantId: string): Cv | null {
    const row = this.db
      .prepare('SELECT * FROM cvs WHERE tenant_id = ? AND applicant_id = ?')
      .get(this.tenantId, applicantId) as Row | undefined;
    return row ? mapCv(row) : null;
  }

  getCv(id: string): Cv | null {
    const row = this.db.prepare('SELECT * FROM cvs WHERE tenant_id = ? AND id = ?').get(this.tenantId, id) as
      | Row
      | undefined;
    return row ? mapCv(row) : null;
  }

  // ------------------------------------------------- memberships & payments

  createMembership(applicantId: string, planCode: string): Membership {
    const id = newId('mem');
    this.db
      .prepare(
        `INSERT INTO memberships (id, tenant_id, applicant_id, plan_code, status, created_at)
         VALUES (?, ?, ?, ?, 'pending_payment', ?)`,
      )
      .run(id, this.tenantId, applicantId, planCode, nowIso());
    const membership = this.getMembership(id);
    if (membership === null) throw new Error('membership insert failed');
    return membership;
  }

  getMembership(id: string): Membership | null {
    const row = this.db
      .prepare('SELECT * FROM memberships WHERE tenant_id = ? AND id = ?')
      .get(this.tenantId, id) as Row | undefined;
    return row ? mapMembership(row) : null;
  }

  getActiveMembership(applicantId: string, now: string = nowIso()): Membership | null {
    const row = this.db
      .prepare(
        `SELECT * FROM memberships
         WHERE tenant_id = ? AND applicant_id = ? AND status = 'active'
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY expires_at DESC LIMIT 1`,
      )
      .get(this.tenantId, applicantId, now) as Row | undefined;
    return row ? mapMembership(row) : null;
  }

  getLatestMembership(applicantId: string): Membership | null {
    const row = this.db
      .prepare('SELECT * FROM memberships WHERE tenant_id = ? AND applicant_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(this.tenantId, applicantId) as Row | undefined;
    return row ? mapMembership(row) : null;
  }

  activateMembership(id: string, expiresAt: string): Membership {
    this.db
      .prepare(`UPDATE memberships SET status = 'active', activated_at = ?, expires_at = ? WHERE tenant_id = ? AND id = ?`)
      .run(nowIso(), expiresAt, this.tenantId, id);
    const membership = this.getMembership(id);
    if (membership === null) throw new Error('membership not found');
    return membership;
  }

  expireLapsedMemberships(now: string = nowIso()): number {
    const result = this.db
      .prepare(
        `UPDATE memberships SET status = 'expired'
         WHERE tenant_id = ? AND status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?`,
      )
      .run(this.tenantId, now);
    return Number(result.changes);
  }

  createPayment(input: {
    applicantId: string;
    membershipId: string;
    amountTzs: number;
    reference: string;
    method: string;
  }): Payment {
    const id = newId('pay');
    this.db
      .prepare(
        `INSERT INTO payments (id, tenant_id, applicant_id, membership_id, amount_tzs, reference, method, status, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`,
      )
      .run(id, this.tenantId, input.applicantId, input.membershipId, input.amountTzs, input.reference, input.method, nowIso());
    const payment = this.getPayment(id);
    if (payment === null) throw new Error('payment insert failed');
    return payment;
  }

  getPayment(id: string): Payment | null {
    const row = this.db.prepare('SELECT * FROM payments WHERE tenant_id = ? AND id = ?').get(this.tenantId, id) as
      | Row
      | undefined;
    return row ? mapPayment(row) : null;
  }

  findPaymentByReference(reference: string): Payment | null {
    const row = this.db
      .prepare('SELECT * FROM payments WHERE tenant_id = ? AND reference = ?')
      .get(this.tenantId, reference) as Row | undefined;
    return row ? mapPayment(row) : null;
  }

  listPayments(status?: PaymentStatus): Payment[] {
    const rows = status
      ? (this.db
          .prepare('SELECT * FROM payments WHERE tenant_id = ? AND status = ? ORDER BY submitted_at')
          .all(this.tenantId, status) as Row[])
      : (this.db
          .prepare('SELECT * FROM payments WHERE tenant_id = ? ORDER BY submitted_at DESC')
          .all(this.tenantId) as Row[]);
    return rows.map(mapPayment);
  }

  reviewPayment(id: string, status: PaymentStatus, reviewedBy: string, note: string | null): Payment {
    this.db
      .prepare('UPDATE payments SET status = ?, reviewed_at = ?, reviewed_by = ?, note = ? WHERE tenant_id = ? AND id = ?')
      .run(status, nowIso(), reviewedBy, note, this.tenantId, id);
    const payment = this.getPayment(id);
    if (payment === null) throw new Error('payment not found');
    return payment;
  }

  // -------------------------------------------------------------- employers

  createEmployer(input: {
    name: string;
    accessCode: string;
    contactName?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
  }): Employer {
    const id = newId('emp');
    this.db
      .prepare(
        `INSERT INTO employers (id, tenant_id, name, access_code, contact_name, contact_phone, contact_email, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.tenantId,
        input.name,
        input.accessCode,
        input.contactName ?? null,
        input.contactPhone ?? null,
        input.contactEmail ?? null,
        nowIso(),
      );
    const employer = this.getEmployer(id);
    if (employer === null) throw new Error('employer insert failed');
    return employer;
  }

  getEmployer(id: string): Employer | null {
    const row = this.db.prepare('SELECT * FROM employers WHERE tenant_id = ? AND id = ?').get(this.tenantId, id) as
      | Row
      | undefined;
    return row ? mapEmployer(row) : null;
  }

  findEmployerByName(name: string): Employer | null {
    const row = this.db
      .prepare('SELECT * FROM employers WHERE tenant_id = ? AND lower(name) = lower(?)')
      .get(this.tenantId, name.trim()) as Row | undefined;
    return row ? mapEmployer(row) : null;
  }

  listEmployers(): Employer[] {
    const rows = this.db
      .prepare('SELECT * FROM employers WHERE tenant_id = ? ORDER BY name')
      .all(this.tenantId) as Row[];
    return rows.map(mapEmployer);
  }

  updateEmployerContact(
    id: string,
    contact: { contactName?: string | null; contactPhone?: string | null; contactEmail?: string | null },
  ): void {
    this.db
      .prepare(
        `UPDATE employers SET contact_name = COALESCE(?, contact_name),
                              contact_phone = COALESCE(?, contact_phone),
                              contact_email = COALESCE(?, contact_email)
         WHERE tenant_id = ? AND id = ?`,
      )
      .run(contact.contactName ?? null, contact.contactPhone ?? null, contact.contactEmail ?? null, this.tenantId, id);
  }

  markEmployerSeen(id: string): void {
    this.db.prepare('UPDATE employers SET last_seen_at = ? WHERE tenant_id = ? AND id = ?').run(nowIso(), this.tenantId, id);
  }

  // -------------------------------------------------------- employer access

  createAccessGrant(input: {
    employerId: string;
    kind: string;
    secretHash: string;
    destination?: string | null;
    expiresAt?: string | null;
  }): string {
    const id = newId('grant');
    this.db
      .prepare(
        `INSERT INTO employer_access_grants (id, tenant_id, employer_id, kind, secret_hash, destination, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.tenantId,
        input.employerId,
        input.kind,
        input.secretHash,
        input.destination ?? null,
        input.expiresAt ?? null,
        nowIso(),
      );
    return id;
  }

  listUsableGrants(
    employerId: string,
    kind: string,
    now: string = nowIso(),
  ): { id: string; secretHash: string; attempts: number }[] {
    const rows = this.db
      .prepare(
        `SELECT id, secret_hash, attempts FROM employer_access_grants
         WHERE tenant_id = ? AND employer_id = ? AND kind = ? AND used_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY created_at DESC`,
      )
      .all(this.tenantId, employerId, kind, now) as Row[];
    return rows.map((row) => ({ id: String(row.id), secretHash: String(row.secret_hash), attempts: Number(row.attempts) }));
  }

  markGrantUsed(id: string): void {
    this.db.prepare('UPDATE employer_access_grants SET used_at = ? WHERE id = ?').run(nowIso(), id);
  }

  bumpGrantAttempts(id: string): void {
    this.db.prepare('UPDATE employer_access_grants SET attempts = attempts + 1 WHERE id = ?').run(id);
  }

  revokeGrants(employerId: string, kind: string): void {
    this.db
      .prepare(
        `UPDATE employer_access_grants SET used_at = ?
         WHERE tenant_id = ? AND employer_id = ? AND kind = ? AND used_at IS NULL`,
      )
      .run(nowIso(), this.tenantId, employerId, kind);
  }

  // ----------------------------------------------------------------- drafts

  createDraft(input: {
    employerId: string | null;
    employerNameGuess: string | null;
    intakeChannel: IntakeChannel;
    rawText: string | null;
    sourceImagePath: string | null;
    extraction: ExtractionResult;
    createdBy: string | null;
  }): JobDraft {
    const id = newId('draft');
    const at = nowIso();
    this.db
      .prepare(
        `INSERT INTO job_drafts
           (id, tenant_id, employer_id, employer_name_guess, intake_channel, raw_text, source_image_path,
            extraction_json, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'extracted', ?, ?, ?)`,
      )
      .run(
        id,
        this.tenantId,
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

  getDraft(id: string): JobDraft | null {
    const row = this.db.prepare('SELECT * FROM job_drafts WHERE tenant_id = ? AND id = ?').get(this.tenantId, id) as
      | Row
      | undefined;
    return row ? mapDraft(row) : null;
  }

  listDrafts(status?: DraftStatus): JobDraft[] {
    const rows = status
      ? (this.db
          .prepare('SELECT * FROM job_drafts WHERE tenant_id = ? AND status = ? ORDER BY created_at DESC')
          .all(this.tenantId, status) as Row[])
      : (this.db
          .prepare('SELECT * FROM job_drafts WHERE tenant_id = ? ORDER BY created_at DESC')
          .all(this.tenantId) as Row[]);
    return rows.map(mapDraft);
  }

  saveDraftCorrections(id: string, overrides: Record<string, unknown>, employerId: string | null): void {
    this.db
      .prepare(
        `UPDATE job_drafts SET overrides_json = ?, employer_id = COALESCE(?, employer_id),
                               status = 'reviewed', updated_at = ?
         WHERE tenant_id = ? AND id = ?`,
      )
      .run(toJson(overrides), employerId, nowIso(), this.tenantId, id);
  }

  markDraftPublished(id: string, jobId: string, employerId: string): void {
    this.db
      .prepare(
        `UPDATE job_drafts SET status = 'published', job_id = ?, employer_id = ?, updated_at = ?
         WHERE tenant_id = ? AND id = ?`,
      )
      .run(jobId, employerId, nowIso(), this.tenantId, id);
  }

  // ------------------------------------------------------------------- jobs

  nextJobReference(prefix: string, year: number = new Date().getUTCFullYear()): string {
    return formatJobReference(prefix, year, this.nextCounter('job', year));
  }

  nextApplicationReference(year: number = new Date().getUTCFullYear()): string {
    return formatApplicationReference(APPLICATION_REFERENCE_PREFIX, year, this.nextCounter('application', year));
  }

  private nextCounter(scope: string, year: number): number {
    const row = this.db
      .prepare(
        `INSERT INTO reference_counters (tenant_id, scope, year, next_value) VALUES (?, ?, ?, 1)
         ON CONFLICT(tenant_id, scope, year) DO UPDATE SET next_value = next_value + 1
         RETURNING next_value`,
      )
      .get(this.tenantId, scope, year) as Row;
    return Number(row.next_value);
  }

  insertJob(job: Omit<Job, 'tenantId' | 'createdAt' | 'updatedAt'>): Job {
    const at = nowIso();
    this.db
      .prepare(
        `INSERT INTO jobs
           (id, tenant_id, employer_id, reference, status, title, location, category, positions,
            salary_amount_min, salary_amount_max, salary_currency, salary_period, salary_plus_tips, salary_monthly_tzs,
            description, responsibilities_json, requirements_json, application_deadline, contact_info,
            accommodation_provided, languages_json, experience_note, certificate_required, immediate_start,
            source_image_path, source_text, intake_channel, published_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        job.id,
        this.tenantId,
        job.employerId,
        job.reference,
        job.status,
        job.title,
        job.location,
        job.category,
        job.positions,
        job.salary.amountMin,
        job.salary.amountMax,
        job.salary.currency,
        job.salary.period,
        toInt(job.salary.plusTips) ?? 0,
        job.salary.monthlyTzs,
        job.description,
        toJson(job.responsibilities),
        toJson(job.requirements),
        job.applicationDeadline,
        job.contactInfo,
        toInt(job.accommodationProvided) ?? 0,
        toJson(job.languages),
        job.experienceNote,
        toInt(job.certificateRequired) ?? 0,
        toInt(job.immediateStart) ?? 0,
        job.sourceImagePath,
        job.sourceText,
        job.intakeChannel,
        job.publishedAt,
        at,
        at,
      );
    const saved = this.getJob(job.id);
    if (saved === null) throw new Error('job insert failed');
    return saved;
  }

  getJob(id: string): Job | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE tenant_id = ? AND id = ?').get(this.tenantId, id) as
      | Row
      | undefined;
    return row ? mapJob(row) : null;
  }

  listPublishedJobs(): Job[] {
    const rows = this.db
      .prepare(`SELECT * FROM jobs WHERE tenant_id = ? AND status = 'published' ORDER BY published_at DESC`)
      .all(this.tenantId) as Row[];
    return rows.map(mapJob);
  }

  listJobsByEmployer(employerId: string): Job[] {
    const rows = this.db
      .prepare('SELECT * FROM jobs WHERE tenant_id = ? AND employer_id = ? ORDER BY created_at DESC')
      .all(this.tenantId, employerId) as Row[];
    return rows.map(mapJob);
  }

  setJobStatus(id: string, status: JobStatus): void {
    const publishedAt = status === 'published' ? nowIso() : null;
    this.db
      .prepare(
        `UPDATE jobs SET status = ?, published_at = COALESCE(?, published_at), updated_at = ?
         WHERE tenant_id = ? AND id = ?`,
      )
      .run(status, publishedAt, nowIso(), this.tenantId, id);
  }

  // ----------------------------------------------------------- applications

  createApplication(input: {
    reference: string;
    jobId: string;
    applicantId: string;
    cvId: string;
    employerId: string;
  }): Application {
    const id = newId('apl');
    const at = nowIso();
    this.db
      .prepare(
        `INSERT INTO applications (id, tenant_id, reference, job_id, applicant_id, cv_id, employer_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'applied', ?, ?)`,
      )
      .run(id, this.tenantId, input.reference, input.jobId, input.applicantId, input.cvId, input.employerId, at, at);
    this.addStatusChange(id, null, 'applied', { kind: 'applicant', id: input.applicantId }, null);
    const application = this.getApplication(id);
    if (application === null) throw new Error('application insert failed');
    return application;
  }

  getApplication(id: string): Application | null {
    const row = this.db.prepare('SELECT * FROM applications WHERE tenant_id = ? AND id = ?').get(this.tenantId, id) as
      | Row
      | undefined;
    return row ? mapApplication(row) : null;
  }

  findApplication(jobId: string, applicantId: string): Application | null {
    const row = this.db
      .prepare('SELECT * FROM applications WHERE tenant_id = ? AND job_id = ? AND applicant_id = ?')
      .get(this.tenantId, jobId, applicantId) as Row | undefined;
    return row ? mapApplication(row) : null;
  }

  listApplicationsForApplicant(applicantId: string): Application[] {
    const rows = this.db
      .prepare('SELECT * FROM applications WHERE tenant_id = ? AND applicant_id = ? ORDER BY created_at DESC')
      .all(this.tenantId, applicantId) as Row[];
    return rows.map(mapApplication);
  }

  countHired(jobId: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS total FROM applications WHERE tenant_id = ? AND job_id = ? AND status = 'hired'`)
      .get(this.tenantId, jobId) as Row;
    return Number(row.total);
  }

  hiredCountsByJob(): Map<string, number> {
    const rows = this.db
      .prepare(
        `SELECT job_id, COUNT(*) AS total FROM applications
         WHERE tenant_id = ? AND status = 'hired' GROUP BY job_id`,
      )
      .all(this.tenantId) as Row[];
    return new Map(rows.map((row) => [String(row.job_id), Number(row.total)]));
  }

  updateApplicationStatus(id: string, status: ApplicationStatus): void {
    this.db
      .prepare('UPDATE applications SET status = ?, updated_at = ? WHERE tenant_id = ? AND id = ?')
      .run(status, nowIso(), this.tenantId, id);
  }

  setApplicationNotes(id: string, notes: string | null): void {
    this.db
      .prepare('UPDATE applications SET employer_notes = ?, updated_at = ? WHERE tenant_id = ? AND id = ?')
      .run(notes, nowIso(), this.tenantId, id);
  }

  addStatusChange(
    applicationId: string,
    fromStatus: ApplicationStatus | null,
    toStatus: ApplicationStatus,
    actor: Actor,
    note: string | null,
  ): void {
    this.db
      .prepare(
        `INSERT INTO application_status_history
           (tenant_id, application_id, from_status, to_status, actor_kind, actor_id, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(this.tenantId, applicationId, fromStatus, toStatus, actor.kind, actor.id, note, nowIso());
  }

  listStatusHistory(applicationId: string): ApplicationStatusChange[] {
    const rows = this.db
      .prepare('SELECT * FROM application_status_history WHERE tenant_id = ? AND application_id = ? ORDER BY id')
      .all(this.tenantId, applicationId) as Row[];
    return rows.map(mapHistory);
  }

  /**
   * The employer's candidate list. employer_id is always in the WHERE clause,
   * so a client can only ever see people who applied to its own jobs.
   */
  listApplicationsForEmployer(employerId: string, filters: ApplicationFilters = {}): ApplicationDetail[] {
    const clauses = ['a.tenant_id = ?', 'a.employer_id = ?'];
    const params: (string | number)[] = [this.tenantId, employerId];

    if (filters.applicationId) {
      clauses.push('a.id = ?');
      params.push(filters.applicationId);
    }
    if (filters.jobId) {
      clauses.push('a.job_id = ?');
      params.push(filters.jobId);
    }
    if (filters.status) {
      clauses.push('a.status = ?');
      params.push(filters.status);
    }
    if (filters.location) {
      clauses.push('lower(p.location) LIKE ?');
      params.push(`%${filters.location.toLowerCase()}%`);
    }
    if (filters.search) {
      clauses.push('(lower(u.full_name) LIKE ? OR lower(c.document_json) LIKE ? OR a.reference LIKE ?)');
      const needle = `%${filters.search.toLowerCase()}%`;
      params.push(needle, needle, `%${filters.search.toUpperCase()}%`);
    }

    const rows = this.db
      .prepare(
        `SELECT a.*,
                u.id AS u_id, u.tenant_id AS u_tenant_id, u.full_name, u.phone, u.email, u.created_at AS u_created_at,
                p.location, p.education_level, p.experience_years, p.skills_json, p.languages_json,
                p.photo_path, p.willing_to_relocate,
                c.document_json,
                j.title AS j_title, j.location AS j_location
         FROM applications a
         JOIN users u ON u.id = a.applicant_id
         JOIN applicant_profiles p ON p.applicant_id = a.applicant_id
         JOIN cvs c ON c.id = a.cv_id
         JOIN jobs j ON j.id = a.job_id
         WHERE ${clauses.join(' AND ')}
         ORDER BY a.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, Math.min(filters.limit ?? 100, 500), filters.offset ?? 0) as Row[];

    return rows.map((row) => ({
      application: mapApplication(row),
      applicant: mapApplicant({
        id: row.u_id,
        tenant_id: row.u_tenant_id,
        full_name: row.full_name,
        phone: row.phone,
        email: row.email,
        created_at: row.u_created_at,
        location: row.location,
        education_level: row.education_level,
        experience_years: row.experience_years,
        skills_json: row.skills_json,
        languages_json: row.languages_json,
        photo_path: row.photo_path,
        willing_to_relocate: row.willing_to_relocate,
      }),
      cv: mapCv(row),
      jobTitle: String(row.j_title),
      jobLocation: String(row.j_location),
    }));
  }

  // ----------------------------------------------------------------- swipes

  recordSwipe(applicantId: string, jobId: string, direction: SwipeDirection): void {
    this.db
      .prepare(
        `INSERT INTO swipes (id, tenant_id, applicant_id, job_id, direction, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(applicant_id, job_id) DO UPDATE SET direction = excluded.direction, created_at = excluded.created_at`,
      )
      .run(newId('swp'), this.tenantId, applicantId, jobId, direction, nowIso());
  }

  /** Jobs already skipped or applied to never come back in the deck. */
  listResolvedJobIds(applicantId: string): Set<string> {
    const rows = this.db
      .prepare(`SELECT job_id FROM swipes WHERE tenant_id = ? AND applicant_id = ? AND direction IN ('left','right')`)
      .all(this.tenantId, applicantId) as Row[];
    return new Set(rows.map((row) => String(row.job_id)));
  }

  listSavedJobIds(applicantId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT job_id FROM swipes WHERE tenant_id = ? AND applicant_id = ? AND direction = 'up' ORDER BY created_at DESC`,
      )
      .all(this.tenantId, applicantId) as Row[];
    return rows.map((row) => String(row.job_id));
  }

  // --------------------------------------------------------------- realtime

  appendEvent(scope: RealtimeScope, scopeId: string, type: string, payload: unknown): StoredEvent {
    const row = this.db
      .prepare(
        `INSERT INTO realtime_events (tenant_id, scope, scope_id, type, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id, created_at`,
      )
      .get(this.tenantId, scope, scopeId, type, toJson(payload), nowIso()) as Row;
    return { id: Number(row.id), scope, scopeId, type, payload, createdAt: String(row.created_at) };
  }

  listEventsSince(scope: RealtimeScope, scopeId: string, sinceId: number, limit = 100): StoredEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM realtime_events WHERE tenant_id = ? AND scope = ? AND scope_id = ? AND id > ?
         ORDER BY id LIMIT ?`,
      )
      .all(this.tenantId, scope, scopeId, sinceId, limit) as Row[];
    return rows.map((row) => ({
      id: Number(row.id),
      scope: String(row.scope) as RealtimeScope,
      scopeId: String(row.scope_id),
      type: String(row.type),
      payload: JSON.parse(String(row.payload_json)) as unknown,
      createdAt: String(row.created_at),
    }));
  }

  // ------------------------------------------------------------------ stats

  /**
   * Counters for the employer page. Viewed, Shortlisted and Interview count
   * every application that ever reached that stage, so a candidate who moves
   * on still counts on the earlier tile.
   */
  jobStats(jobId: string): JobStats | null {
    const job = this.getJob(jobId);
    if (job === null) return null;
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) AS applications,
           SUM(CASE WHEN a.status = 'applied' THEN 1 ELSE 0 END) AS new_applications,
           SUM(CASE WHEN a.status = 'hired' THEN 1 ELSE 0 END) AS hired,
           SUM(CASE WHEN a.status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
           SUM(CASE WHEN EXISTS (SELECT 1 FROM application_status_history h WHERE h.application_id = a.id AND h.to_status = 'viewed') THEN 1 ELSE 0 END) AS viewed,
           SUM(CASE WHEN EXISTS (SELECT 1 FROM application_status_history h WHERE h.application_id = a.id AND h.to_status = 'shortlisted') THEN 1 ELSE 0 END) AS shortlisted,
           SUM(CASE WHEN EXISTS (SELECT 1 FROM application_status_history h WHERE h.application_id = a.id AND h.to_status = 'interview') THEN 1 ELSE 0 END) AS interview
         FROM applications a WHERE a.tenant_id = ? AND a.job_id = ?`,
      )
      .get(this.tenantId, jobId) as Row;

    const hired = Number(row.hired ?? 0);
    return {
      jobId,
      title: job.title,
      location: job.location,
      positions: job.positions,
      applications: Number(row.applications ?? 0),
      newApplications: Number(row.new_applications ?? 0),
      viewed: Number(row.viewed ?? 0),
      shortlisted: Number(row.shortlisted ?? 0),
      interview: Number(row.interview ?? 0),
      rejected: Number(row.rejected ?? 0),
      hired,
      remainingPositions: Math.max(0, job.positions - hired),
    };
  }

  employerStats(employerId: string): JobStats[] {
    return this.listJobsByEmployer(employerId)
      .map((job) => this.jobStats(job.id))
      .filter((stats): stats is JobStats => stats !== null);
  }

  /** The agency's control table: every client, every job, live counts. */
  agencyOverview(): AgencyOverviewRow[] {
    const rows = this.db
      .prepare(
        `SELECT j.id AS job_id, j.title, j.positions, e.id AS employer_id, e.name AS employer_name, e.last_seen_at,
                (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id) AS applications,
                (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id AND a.status = 'applied') AS new_applications,
                (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id AND a.status = 'hired') AS hired,
                (SELECT COUNT(*) FROM applications a
                   JOIN application_status_history h ON h.application_id = a.id AND h.to_status = 'shortlisted'
                 WHERE a.job_id = j.id) AS shortlisted
         FROM jobs j
         JOIN employers e ON e.id = j.employer_id
         WHERE j.tenant_id = ? AND j.status IN ('published', 'filled')
         ORDER BY applications DESC, j.created_at DESC`,
      )
      .all(this.tenantId) as Row[];

    return rows.map((row) => {
      const hired = Number(row.hired);
      return {
        employerId: String(row.employer_id),
        employerName: String(row.employer_name),
        jobId: String(row.job_id),
        jobTitle: String(row.title),
        applications: Number(row.applications),
        newApplications: Number(row.new_applications),
        shortlisted: Number(row.shortlisted),
        hired,
        remainingPositions: Math.max(0, Number(row.positions) - hired),
        employerLastSeenAt: textOrNull(row.last_seen_at),
      };
    });
  }
}
