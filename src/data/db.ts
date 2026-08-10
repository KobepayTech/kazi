import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS agency_staff (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'officer',
  password_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  industry TEXT,
  location TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  portal_url TEXT,
  portal_created_at TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employer_access_grants (
  id TEXT PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS employer_sessions (
  token_hash TEXT PRIMARY KEY,
  employer_id TEXT NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS applicant_sessions (
  token_hash TEXT PRIMARY KEY,
  applicant_id TEXT NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vacancy_drafts (
  id TEXT PRIMARY KEY,
  employer_id TEXT REFERENCES employers(id) ON DELETE SET NULL,
  employer_name_guess TEXT,
  intake_channel TEXT NOT NULL,
  raw_text TEXT,
  source_image_path TEXT,
  extraction_json TEXT NOT NULL,
  overrides_json TEXT,
  status TEXT NOT NULL DEFAULT 'extracted',
  vacancy_id TEXT REFERENCES vacancies(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drafts_status ON vacancy_drafts(status, created_at DESC);

CREATE TABLE IF NOT EXISTS vacancies (
  id TEXT PRIMARY KEY,
  employer_id TEXT NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  agency_ref TEXT NOT NULL,
  slug TEXT NOT NULL,
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
  accommodation_provided INTEGER NOT NULL DEFAULT 0,
  meals_provided INTEGER NOT NULL DEFAULT 0,
  transport_provided INTEGER NOT NULL DEFAULT 0,
  employment_type TEXT NOT NULL DEFAULT 'full_time',
  work_mode TEXT NOT NULL DEFAULT 'onsite',
  gender_requirement TEXT NOT NULL DEFAULT 'any',
  age_min INTEGER,
  age_max INTEGER,
  languages_json TEXT NOT NULL DEFAULT '[]',
  experience_years_min INTEGER NOT NULL DEFAULT 0,
  experience_note TEXT,
  education_min TEXT NOT NULL DEFAULT 'none',
  certificate_required INTEGER NOT NULL DEFAULT 0,
  immediate_start INTEGER NOT NULL DEFAULT 0,
  start_date TEXT,
  application_deadline TEXT,
  description TEXT,
  source_image_path TEXT,
  source_text TEXT,
  intake_channel TEXT NOT NULL DEFAULT 'manual_entry',
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (employer_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_vacancies_status ON vacancies(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_vacancies_employer ON vacancies(employer_id, status);

CREATE TABLE IF NOT EXISTS applicants (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  email TEXT,
  location TEXT NOT NULL,
  gender TEXT NOT NULL DEFAULT 'undisclosed',
  date_of_birth TEXT,
  education_level TEXT NOT NULL DEFAULT 'none',
  languages_json TEXT NOT NULL DEFAULT '[]',
  willing_to_relocate INTEGER NOT NULL DEFAULT 0,
  available_from TEXT,
  soko_huru_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cvs (
  id TEXT PRIMARY KEY,
  applicant_id TEXT NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  categories_json TEXT NOT NULL DEFAULT '[]',
  headline TEXT,
  experience_years INTEGER NOT NULL DEFAULT 0,
  education_level TEXT NOT NULL DEFAULT 'none',
  skills_json TEXT NOT NULL DEFAULT '[]',
  languages_json TEXT NOT NULL DEFAULT '[]',
  certificates_json TEXT NOT NULL DEFAULT '[]',
  preferred_salary_tzs INTEGER,
  file_path TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cvs_applicant ON cvs(applicant_id);

CREATE TABLE IF NOT EXISTS applicant_preferences (
  applicant_id TEXT PRIMARY KEY REFERENCES applicants(id) ON DELETE CASCADE,
  locations_json TEXT NOT NULL DEFAULT '[]',
  categories_json TEXT NOT NULL DEFAULT '[]',
  min_salary_tzs INTEGER,
  max_salary_tzs INTEGER,
  certificate_required INTEGER,
  education_level_max TEXT,
  experience_years_max INTEGER,
  accommodation_required_outside_home INTEGER NOT NULL DEFAULT 0,
  employment_types_json TEXT NOT NULL DEFAULT '[]',
  work_modes_json TEXT NOT NULL DEFAULT '[]',
  willing_to_relocate INTEGER NOT NULL DEFAULT 0,
  gender_neutral_only INTEGER NOT NULL DEFAULT 0,
  immediate_start_only INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS membership_packages (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_tzs INTEGER NOT NULL,
  duration_days INTEGER NOT NULL,
  covers_non_certificate_jobs INTEGER NOT NULL DEFAULT 1,
  covers_certificate_jobs INTEGER NOT NULL DEFAULT 0,
  application_limit INTEGER,
  categories_json TEXT,
  priority_review INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  applicant_id TEXT NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  package_code TEXT NOT NULL REFERENCES membership_packages(code),
  status TEXT NOT NULL DEFAULT 'pending_payment',
  paid_amount_tzs INTEGER,
  payment_reference TEXT,
  activated_at TEXT,
  expires_at TEXT,
  applications_used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memberships_applicant ON memberships(applicant_id, status);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  vacancy_id TEXT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  applicant_id TEXT NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  cv_id TEXT NOT NULL REFERENCES cvs(id),
  employer_id TEXT NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'applied',
  match_score INTEGER NOT NULL DEFAULT 0,
  employer_notes TEXT,
  interview_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (vacancy_id, applicant_id)
);
CREATE INDEX IF NOT EXISTS idx_applications_vacancy ON applications(vacancy_id, status);
CREATE INDEX IF NOT EXISTS idx_applications_employer ON applications(employer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_applications_applicant ON applications(applicant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS application_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_application_events ON application_events(application_id, id);

CREATE TABLE IF NOT EXISTS swipes (
  id TEXT PRIMARY KEY,
  applicant_id TEXT NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  vacancy_id TEXT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (applicant_id, vacancy_id)
);

CREATE TABLE IF NOT EXISTS reference_counters (
  year INTEGER PRIMARY KEY,
  next_value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS realtime_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_realtime_scope ON realtime_events(scope, scope_id, id);
`;

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
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
