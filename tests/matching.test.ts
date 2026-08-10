import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ageOf,
  eligibilityFailures,
  placesMatch,
  preferenceMismatches,
  scoreMatch,
  selectBestCv,
} from '../src/domain/matching.ts';
import { withMonthlyTzs } from '../src/domain/salary.ts';
import type { Applicant, ApplicantPreferences, Cv, Vacancy } from '../src/domain/types.ts';

function vacancy(overrides: Partial<Vacancy> = {}): Vacancy {
  return {
    id: 'vac_1',
    employerId: 'emp_1',
    agencyRef: 'SH-JOB-2026-0001',
    slug: 'hotel-attendant',
    status: 'published',
    title: 'Hotel Attendant',
    location: 'Zanzibar',
    category: 'hospitality',
    positions: 8,
    salary: withMonthlyTzs({ amountMin: 200, amountMax: null, currency: 'USD', period: 'month', plusTips: true }),
    accommodationProvided: true,
    mealsProvided: false,
    transportProvided: false,
    employmentType: 'full_time',
    workMode: 'onsite',
    genderRequirement: 'female',
    ageMin: 18,
    ageMax: 35,
    languages: ['English'],
    experienceYearsMin: 1,
    experienceNote: 'Hospitality experience preferred',
    educationMin: 'none',
    certificateRequired: false,
    immediateStart: true,
    startDate: null,
    applicationDeadline: null,
    description: null,
    sourceImagePath: null,
    sourceText: null,
    intakeChannel: 'whatsapp_text',
    publishedAt: '2026-08-01T00:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function applicant(overrides: Partial<Applicant> = {}): Applicant {
  return {
    id: 'app_1',
    fullName: 'Neema Joseph',
    phone: '+255711000001',
    email: null,
    location: 'Dar es Salaam',
    gender: 'female',
    dateOfBirth: '2001-04-12',
    educationLevel: 'secondary',
    languages: ['English', 'Swahili'],
    willingToRelocate: true,
    availableFrom: null,
    sokoHuruVerified: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function cv(overrides: Partial<Cv> = {}): Cv {
  return {
    id: 'cv_1',
    applicantId: 'app_1',
    label: 'Hospitality CV',
    categories: ['hospitality'],
    headline: null,
    experienceYears: 2,
    educationLevel: 'secondary',
    skills: [],
    languages: ['English', 'Swahili'],
    certificates: [],
    preferredSalaryTzs: null,
    filePath: null,
    isDefault: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function preferences(overrides: Partial<ApplicantPreferences> = {}): ApplicantPreferences {
  return {
    applicantId: 'app_1',
    locations: [],
    categories: [],
    minSalaryTzs: null,
    maxSalaryTzs: null,
    certificateRequired: null,
    educationLevelMax: null,
    experienceYearsMax: null,
    accommodationRequiredOutsideHome: false,
    employmentTypes: [],
    workModes: [],
    willingToRelocate: true,
    genderNeutralOnly: false,
    immediateStartOnly: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('place names match across spelling and extra detail', () => {
  assert.ok(placesMatch('Zanzibar', 'Zanzibar (Nungwi)'));
  assert.ok(placesMatch('dar-es-salaam', 'Dar es Salaam'));
  assert.ok(!placesMatch('Arusha', 'Mwanza'));
});

test('the minimum salary filter compares against the normalised monthly figure', () => {
  const job = vacancy(); // USD 200 -> TSh 520,000
  assert.deepEqual(preferenceMismatches(job, preferences({ minSalaryTzs: 500_000 }), applicant()), []);
  assert.deepEqual(preferenceMismatches(job, preferences({ minSalaryTzs: 700_000 }), applicant()), [
    'salary_below_minimum',
  ]);
});

test('"accommodation required outside my home area" only bites away from home', () => {
  const away = vacancy({ accommodationProvided: false });
  const home = vacancy({ location: 'Dar es Salaam', accommodationProvided: false });
  const prefs = preferences({ accommodationRequiredOutsideHome: true });

  assert.deepEqual(preferenceMismatches(away, prefs, applicant()), ['accommodation_required']);
  assert.deepEqual(preferenceMismatches(home, prefs, applicant()), []);
});

test('the certificate filter works in both directions', () => {
  const noCertificate = vacancy({ certificateRequired: false });
  const certificate = vacancy({ certificateRequired: true });

  assert.deepEqual(preferenceMismatches(noCertificate, preferences({ certificateRequired: false }), applicant()), []);
  assert.deepEqual(preferenceMismatches(certificate, preferences({ certificateRequired: false }), applicant()), [
    'certificate_preference',
  ]);
});

test('gender-neutral-only hides restricted vacancies', () => {
  assert.deepEqual(preferenceMismatches(vacancy(), preferences({ genderNeutralOnly: true }), applicant()), [
    'gender_neutral_only',
  ]);
  assert.deepEqual(
    preferenceMismatches(vacancy({ genderRequirement: 'any' }), preferences({ genderNeutralOnly: true }), applicant()),
    [],
  );
});

test('someone not willing to relocate only sees vacancies near home', () => {
  const prefs = preferences({ willingToRelocate: false });
  assert.deepEqual(preferenceMismatches(vacancy(), prefs, applicant({ willingToRelocate: false })), ['location']);
});

test('employer requirements are hard gates, not just ranking', () => {
  const job = vacancy();
  const male = applicant({ gender: 'male' });
  const failures = eligibilityFailures(job, male, { hiredCount: 0 });
  assert.deepEqual(failures.map((failure) => failure.code), ['gender_requirement']);

  const tooYoung = applicant({ dateOfBirth: '2012-01-01' });
  assert.ok(
    eligibilityFailures(job, tooYoung, { hiredCount: 0, now: new Date('2026-08-10') }).some(
      (failure) => failure.code === 'age_requirement',
    ),
  );
});

test('a filled vacancy stops accepting applications', () => {
  const failures = eligibilityFailures(vacancy({ positions: 2 }), applicant(), { hiredCount: 2 });
  assert.deepEqual(failures.map((failure) => failure.code), ['positions_filled']);
});

test('a closed vacancy and a passed deadline both block', () => {
  assert.ok(
    eligibilityFailures(vacancy({ status: 'closed' }), applicant(), { hiredCount: 0 }).some(
      (failure) => failure.code === 'vacancy_not_open',
    ),
  );
  assert.ok(
    eligibilityFailures(vacancy({ applicationDeadline: '2026-01-01T00:00:00.000Z' }), applicant(), {
      hiredCount: 0,
      now: new Date('2026-08-10'),
    }).some((failure) => failure.code === 'deadline_passed'),
  );
});

test('the match score rewards the things the employer actually asked for', () => {
  const strong = scoreMatch(vacancy(), applicant({ location: 'Zanzibar' }), cv());
  const weak = scoreMatch(
    vacancy(),
    applicant({ location: 'Mbeya', willingToRelocate: false, languages: ['Swahili'] }),
    cv({ categories: ['driving'], experienceYears: 0, languages: ['Swahili'] }),
  );

  assert.ok(strong.score > weak.score);
  assert.ok(strong.score >= 90, `expected a strong match, got ${strong.score}`);
  assert.ok(strong.reasons.includes('Based in Zanzibar'));
  assert.equal(strong.components.reduce((sum, part) => sum + part.weight, 0), 100);
});

test('the most relevant CV is the one that gets submitted', () => {
  const hospitality = cv({ id: 'cv_hotel', label: 'Hospitality CV', categories: ['hospitality'], isDefault: false });
  const driving = cv({ id: 'cv_driving', label: 'Driving CV', categories: ['driving'], isDefault: true });

  const best = selectBestCv(vacancy(), applicant(), [driving, hospitality]);
  assert.equal(best?.cv.id, 'cv_hotel');
});

test('with no CVs there is nothing to submit', () => {
  assert.equal(selectBestCv(vacancy(), applicant(), []), null);
});

test('ages are counted from the date of birth', () => {
  assert.equal(ageOf('2001-04-12', new Date('2026-08-10')), 25);
  assert.equal(ageOf('2001-12-31', new Date('2026-08-10')), 24);
  assert.equal(ageOf(null), null);
});
