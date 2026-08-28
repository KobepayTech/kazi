import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApplicationPackage } from '../src/domain/application-package.ts';
import type { Applicant, ApplicantPreferences, Cv, Job } from '../src/domain/types.ts';

const applicant: Applicant = {
  id: 'app_1',
  tenantId: 'tenant_1',
  fullName: 'Neema Joseph',
  phone: '+255700000000',
  email: 'neema@example.com',
  location: 'Dar es Salaam',
  educationLevel: 'diploma',
  experienceYears: 4,
  skills: ['customer service', 'POS', 'cash handling', 'Excel'],
  languages: ['Swahili', 'English'],
  photoPath: null,
  willingToRelocate: false,
  createdAt: '2026-08-22T00:00:00.000Z',
};

const preferences: ApplicantPreferences = {
  applicantId: applicant.id,
  tenantId: applicant.tenantId,
  categories: ['retail'],
  locations: ['Dar es Salaam'],
  minSalaryTzs: 500_000,
  certificateRequired: null,
  updatedAt: '2026-08-22T00:00:00.000Z',
};

const cv: Cv = {
  id: 'cv_1',
  tenantId: applicant.tenantId,
  applicantId: applicant.id,
  fullName: applicant.fullName,
  headline: 'Retail · 4 years experience',
  summary: 'Profile summary',
  location: applicant.location,
  phone: applicant.phone,
  email: applicant.email,
  educationLevel: applicant.educationLevel,
  experienceYears: applicant.experienceYears,
  categories: ['retail'],
  skills: [...applicant.skills],
  languages: [...applicant.languages],
  certificates: [],
  photoPath: null,
  generatedAt: '2026-08-22T00:00:00.000Z',
};

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job_1',
    tenantId: applicant.tenantId,
    employerId: 'emp_1',
    reference: 'SH-JOB-2026-0001',
    status: 'published',
    title: 'Retail Customer Service Associate',
    location: 'Dar es Salaam',
    category: 'retail',
    positions: 2,
    salary: {
      amountMin: 600_000,
      amountMax: null,
      currency: 'TZS',
      period: 'month',
      plusTips: false,
      monthlyTzs: 600_000,
    },
    description: 'Serve customers and operate POS.',
    responsibilities: ['Serve customers', 'Handle point-of-sale transactions'],
    requirements: ['2 years customer service experience'],
    applicationDeadline: null,
    contactInfo: null,
    accommodationProvided: false,
    languages: ['Swahili', 'English'],
    experienceNote: '2 years experience required',
    certificateRequired: false,
    immediateStart: false,
    sourceImagePath: null,
    sourceText: null,
    intakeChannel: 'pasted_text',
    publishedAt: '2026-08-22T00:00:00.000Z',
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
    ...overrides,
  };
}

test('builds a truthful job-specific package from existing applicant facts', () => {
  const result = buildApplicationPackage({
    applicant,
    cv,
    job: job(),
    employerName: 'Kariakoo Retail Ltd',
    preferences,
  });

  assert.equal(result.language, 'en');
  assert.match(result.tailoredCvText, /Candidate — Retail Customer Service Associate/);
  assert.match(result.tailoredCvText, /customer service \(matched to vacancy\)/);
  assert.match(result.coverLetterText, /4 year\(s\) of work experience/);
  assert.match(result.coverLetterText, /customer service/);
  assert.match(result.interviewPrep.truthReminder, /Do not invent experience/);
  assert.ok(result.fit.score >= 60);
});

test('does not claim achievements or specific past roles that are not in the profile', () => {
  const result = buildApplicationPackage({
    applicant,
    cv,
    job: job(),
    employerName: 'Kariakoo Retail Ltd',
    preferences,
  });

  const allText = [result.tailoredCvText, result.coverLetterText].join('\n');
  assert.doesNotMatch(allText, /increased sales|managed a team|worked at Kariakoo Retail|award-winning/i);
  assert.match(allText, /no experience or achievements are invented/i);
});

test('uses Swahili for a clearly Swahili vacancy', () => {
  const swahiliJob = job({
    title: 'Mhudumu wa Duka',
    description: 'Tunatafuta mwombaji kwa nafasi ya kazi ya mhudumu.',
    requirements: ['Uzoefu wa miaka 2', 'Elimu ya diploma'],
    responsibilities: ['Kuhudumia wateja', 'Kutumia POS'],
    sourceText: 'Nafasi ya kazi. Sifa za mwombaji. Mshahara utajadiliwa.',
  });
  const result = buildApplicationPackage({
    applicant,
    cv,
    job: swahiliJob,
    employerName: 'Duka Bora',
    preferences,
  });

  assert.equal(result.language, 'sw');
  assert.match(result.coverLetterText, /Ndugu Timu ya Ajira/);
  assert.match(result.interviewPrep.truthReminder, /Usibuni uzoefu/);
});
