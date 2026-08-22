import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateJobFit, fitVerdict } from '../src/domain/matching.ts';
import type { Applicant, ApplicantPreferences, Job } from '../src/domain/types.ts';

const applicant: Applicant = {
  id: 'app_1',
  tenantId: 'tenant_1',
  fullName: 'Neema Joseph',
  phone: '+255700000000',
  email: null,
  location: 'Dar es Salaam',
  educationLevel: 'diploma',
  experienceYears: 4,
  skills: ['customer service', 'POS', 'cash handling'],
  languages: ['Swahili', 'English'],
  photoPath: null,
  willingToRelocate: false,
  createdAt: '2026-08-22T00:00:00.000Z',
};

const preferences: ApplicantPreferences = {
  applicantId: applicant.id,
  tenantId: applicant.tenantId,
  categories: ['retail'],
  locations: [],
  minSalaryTzs: 500_000,
  certificateRequired: null,
  updatedAt: '2026-08-22T00:00:00.000Z',
};

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job_1',
    tenantId: 'tenant_1',
    employerId: 'emp_1',
    reference: 'SH-JOB-2026-0001',
    status: 'published',
    title: 'Retail Customer Service Associate',
    location: 'Dar es Salaam',
    category: 'retail',
    positions: 2,
    salary: {
      amountMin: 700_000,
      amountMax: null,
      currency: 'TZS',
      period: 'month',
      plusTips: false,
      monthlyTzs: 700_000,
    },
    description: 'Serve customers, operate the POS and support daily store sales.',
    responsibilities: ['Customer service', 'Cash handling and POS operation'],
    requirements: ['At least 2 years experience', 'Good English and Swahili'],
    applicationDeadline: null,
    contactInfo: null,
    accommodationProvided: false,
    languages: ['English', 'Swahili'],
    experienceNote: 'Minimum 2 years experience',
    certificateRequired: true,
    immediateStart: true,
    sourceImagePath: null,
    sourceText: null,
    intakeChannel: 'pasted_text',
    publishedAt: '2026-08-22T00:00:00.000Z',
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
    ...overrides,
  };
}

test('a clearly aligned applicant receives a strong Kobe Fit score', () => {
  const fit = evaluateJobFit(applicant, job(), preferences);
  assert.equal(fit.locationPass, true);
  assert.equal(fit.verdict, 'strong');
  assert.ok(fit.score >= 75);
  assert.ok(fit.strengths.some((entry) => /Relevant skills/.test(entry)));
  assert.ok(fit.strengths.some((entry) => /experience requirement/.test(entry)));
});

test('location is treated as a deal-breaker when the applicant will not relocate', () => {
  const fit = evaluateJobFit(applicant, job({ location: 'Mwanza' }), preferences);
  assert.equal(fit.locationPass, false);
  assert.ok(fit.score <= 44);
  assert.ok(fit.gaps.some((entry) => /Mwanza/.test(entry)));
});

test('certificate requirements stay visible instead of being hidden by other strengths', () => {
  const secondaryApplicant: Applicant = { ...applicant, educationLevel: 'secondary' };
  const fit = evaluateJobFit(secondaryApplicant, job(), preferences);
  assert.ok(fit.score <= 44);
  assert.ok(fit.gaps.some((entry) => /certificate/i.test(entry)));
});

test('fit verdict thresholds follow the merged AI evaluation framework', () => {
  assert.equal(fitVerdict(90), 'strong');
  assert.equal(fitVerdict(70), 'good');
  assert.equal(fitVerdict(50), 'moderate');
  assert.equal(fitVerdict(35), 'weak');
  assert.equal(fitVerdict(20), 'poor');
});
