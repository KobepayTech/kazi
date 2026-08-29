import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Every business table carries tenant_id. KobeOS is the platform and the
 * agency is the tenant, so a second agency is a row here, not a fork.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  api_key_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id, role);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_subject ON sessions(subject_kind, subject_id);

CREATE TABLE IF NOT EXISTS applicant_profiles (
  applicant_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location TEXT NOT NULL,
  education_level TEXT NOT NULL DEFAULT 'none',
  experience_years INTEGER NOT NULL DEFAULT 0,
  skills_json TEXT NOT NULL DEFAULT '[]',
  languages_json TEXT NOT NULL DEFAULT '[]',
  photo_path TEXT,
  willing_to_relocate INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profiles_tenant ON applicant_profiles(tenant_id);

CREATE TABLE IF NOT EXISTS applicant_preferences (
  applicant_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  categories_json TEXT NOT NULL DEFAULT '[]',
  locations_json TEXT NOT NULL DEFAULT '[]',
  min_salary_tzs INTEGER,
  certificate_required INTEGER,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cvs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  applicant_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  document_json TEXT NOT NULL,
  generated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS applicant_documents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  applicant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  file_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_applicant_documents_applicant
  ON applicant_documents(tenant_id, applicant_id, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS membership_plans (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  price_tzs INTEGER NOT NULL,
  duration_days INTEGER NOT NULL,
  covers_non_certificate_jobs INTEGER NOT NULL DEFAULT 1,
  covers_certificate_jobs INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  applicant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_payment',
  activated_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memberships_applicant ON memberships(applicant_id, status);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  applicant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  membership_id TEXT NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  amount_tzs INTEGER NOT NULL,
  reference TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'mobile_money',
  status TEXT NOT NULL DEFAULT 'submitted',
  note TEXT,
  submitted_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT,
  UNIQUE (tenant_id, reference)
);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(tenant_id, status, submitted_at);

CREATE TABLE IF NOT EXISTS employers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  access_code TEXT NOT NULL UNIQUE,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_employers_tenant ON employers(tenant_id, name);

CREATE TABLE IF NOT EXISTS employer_access_grants (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employer_id TEXT NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  destination TEXT,
  expires_at TEXT,
  used_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_grants_employer ON employer_access_grants(employer_id, kind);

CREATE TABLE IF NOT EXISTS job_drafts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employer_id TEXT REFERENCES employers(id) ON DELETE SET NULL,
  employer_name_guess TEXT,
  intake_channel TEXT NOT NULL,
  raw_text TEXT,
  source_image_path TEXT,
  extraction_json TEXT NOT NULL,
  overrides_json TEXT,
  status TEXT NOT NULL DEFAULT 'extracted',
  job_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drafts_status ON job_drafts(tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employer_id TEXT NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  title TEXT NOT NULL,
  location TEXT NOT NULL,
  category TEXT NOT NULL,
  positions INTEGER NOT NULL DEFAULT 1,
  salary_amount_min REAL,
  salary_amount_max REAL,
  salary_currency TEXT NOT NULL DEFAULT 'TZS',
  salary_period TEXT NOT NULL DEFAULT 'month',
  salary_plus_tips INTEGER NOT NULL DEFAULT 0,
  salary_monthly_tzs INTEGER,
  description TEXT,
  responsibilities_json TEXT NOT NULL DEFAULT '[]',
  requirements_json TEXT NOT NULL DEFAULT '[]',
  application_deadline TEXT,
  contact_info TEXT,
  accommodation_provided INTEGER NOT NULL DEFAULT 0,
  languages_json TEXT NOT NULL DEFAULT '[]',
  experience_note TEXT,
  certificate_required INTEGER NOT NULL DEFAULT 0,
  immediate_start INTEGER NOT NULL DEFAULT 0,
  source_image_path TEXT,
  source_text TEXT,
  intake_channel TEXT NOT NULL DEFAULT 'manual_entry',
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, reference)
);
CREATE INDEX IF NOT EXISTS idx_jobs_feed ON jobs(tenant_id, status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_employer ON jobs(employer_id, status);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reference TEXT NOT NULL UNIQUE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  applicant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cv_id TEXT NOT NULL REFERENCES cvs(id),
  employer_id TEXT NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'applied',
  employer_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (job_id, applicant_id)
);
CREATE INDEX IF NOT EXISTS idx_applications_job ON applications(job_id, status);
CREATE INDEX IF NOT EXISTS idx_applications_employer ON applications(employer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_applications_applicant ON applications(applicant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS application_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_status_history ON application_status_history(application_id, id);

CREATE TABLE IF NOT EXISTS swipes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  applicant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (applicant_id, job_id)
);

CREATE TABLE IF NOT EXISTS reference_counters (
  tenant_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  year INTEGER NOT NULL,
  next_value INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, scope, year)
);

CREATE TABLE IF NOT EXISTS realtime_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_realtime_scope ON realtime_events(scope, scope_id, id);
`;

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function toInt(value: boolean | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return value ? 1 : 0;
}

export function toBool(value: unknown): boolean {
  return value === 1 || value === true || value === '1';
}

export function toBoolOrNull(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  return toBool(value);
}

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function fromJsonArray<T>(value: unknown, fallback: T[] = []): T[] {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

export function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
