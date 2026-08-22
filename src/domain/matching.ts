import { EDUCATION_ORDER } from './types.ts';
import { placesMatch } from './feed.ts';
import type { Applicant, ApplicantPreferences, Job } from './types.ts';

/**
 * Lightweight, deterministic candidate/job matching for the MVP.
 *
 * This adapts the useful idea from the ai-job-search branch (score a role before
 * applying) to KobeOS' actual applicant and vacancy data. It intentionally does
 * not invent behavioural/culture data that KobeOS does not collect yet.
 */
export type FitVerdict = 'strong' | 'good' | 'moderate' | 'weak' | 'poor';

export type JobFitDimensions = {
  skills: number;
  experience: number;
  location: number;
  language: number;
  education: number;
  salary: number;
};

export type JobFit = {
  score: number;
  verdict: FitVerdict;
  locationPass: boolean;
  dimensions: JobFitDimensions;
  strengths: string[];
  gaps: string[];
};

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ').trim();
}

function phraseAppears(phrase: string, haystack: string): boolean {
  const needle = normalise(phrase);
  if (needle.length < 2) return false;
  if (haystack.includes(needle)) return true;
  const words = needle.split(' ').filter((word) => word.length >= 3);
  return words.length > 0 && words.every((word) => haystack.includes(word));
}

function jobText(job: Job): string {
  return normalise([
    job.title,
    job.description ?? '',
    ...job.requirements,
    ...job.responsibilities,
    job.experienceNote ?? '',
  ].join(' '));
}

function requiredExperienceYears(job: Job): number | null {
  const source = [job.experienceNote ?? '', ...job.requirements].join(' ');
  const matches = [...source.matchAll(/(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)/gi)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
  return matches.length === 0 ? null : Math.max(...matches);
}

function skillsDimension(applicant: Applicant, job: Job): { score: number; matched: string[] } {
  if (applicant.skills.length === 0) return { score: 55, matched: [] };
  const text = jobText(job);
  const matched = applicant.skills.filter((skill) => phraseAppears(skill, text));
  // A neutral base prevents sparse vacancy text from incorrectly declaring a poor fit.
  return { score: clamp(50 + (50 * matched.length) / applicant.skills.length), matched };
}

function experienceDimension(applicant: Applicant, job: Job): { score: number; required: number | null } {
  const required = requiredExperienceYears(job);
  if (required === null || required <= 0) return { score: 85, required: null };
  if (applicant.experienceYears >= required) return { score: 100, required };
  return { score: clamp(20 + 80 * (applicant.experienceYears / required)), required };
}

function languageDimension(applicant: Applicant, job: Job): { score: number; missing: string[] } {
  if (job.languages.length === 0) return { score: 100, missing: [] };
  const spoken = applicant.languages.map(normalise);
  const missing = job.languages.filter((language) => {
    const wanted = normalise(language);
    return !spoken.some((candidate) => candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate));
  });
  return { score: clamp(100 * (job.languages.length - missing.length) / job.languages.length), missing };
}

function educationDimension(applicant: Applicant, job: Job): number {
  if (!job.certificateRequired) return 100;
  const applicantRank = EDUCATION_ORDER.indexOf(applicant.educationLevel);
  const certificateRank = EDUCATION_ORDER.indexOf('certificate');
  return applicantRank >= certificateRank ? 100 : 25;
}

function salaryDimension(job: Job, preferences: ApplicantPreferences | null): number {
  const minimum = preferences?.minSalaryTzs ?? null;
  if (minimum === null) return 100;
  const monthly = job.salary.monthlyTzs;
  if (monthly === null) return 60;
  if (monthly >= minimum) return 100;
  return clamp(100 * monthly / minimum);
}

export function fitVerdict(score: number): FitVerdict {
  if (score >= 75) return 'strong';
  if (score >= 60) return 'good';
  if (score >= 45) return 'moderate';
  if (score >= 30) return 'weak';
  return 'poor';
}

export function fitVerdictLabel(verdict: FitVerdict): string {
  return ({ strong: 'Strong fit', good: 'Good fit', moderate: 'Moderate fit', weak: 'Weak fit', poor: 'Poor fit' })[verdict];
}

export function evaluateJobFit(
  applicant: Applicant,
  job: Job,
  preferences: ApplicantPreferences | null = null,
): JobFit {
  const skills = skillsDimension(applicant, job);
  const experience = experienceDimension(applicant, job);
  const sameLocation = placesMatch(applicant.location, job.location);
  const locationPass = sameLocation || applicant.willingToRelocate;
  const location = sameLocation ? 100 : applicant.willingToRelocate ? 70 : 15;
  const language = languageDimension(applicant, job);
  const education = educationDimension(applicant, job);
  const salary = salaryDimension(job, preferences);

  const dimensions: JobFitDimensions = {
    skills: skills.score,
    experience: experience.score,
    location,
    language: language.score,
    education,
    salary,
  };

  let score = clamp(
    dimensions.skills * 0.35 +
    dimensions.experience * 0.25 +
    dimensions.location * 0.15 +
    dimensions.language * 0.10 +
    dimensions.education * 0.10 +
    dimensions.salary * 0.05,
  );

  // Location is a deal-breaker in the source evaluation framework unless the
  // applicant explicitly says they will relocate. Certificate requirements are
  // also kept visible instead of being hidden by a high score elsewhere.
  if (!locationPass) score = Math.min(score, 44);
  if (job.certificateRequired && education < 100) score = Math.min(score, 44);

  const strengths: string[] = [];
  const gaps: string[] = [];

  if (skills.matched.length > 0) strengths.push(`Relevant skills: ${skills.matched.slice(0, 3).join(', ')}`);
  if (experience.required === null) {
    strengths.push(`${applicant.experienceYears} year(s) of experience on profile`);
  } else if (applicant.experienceYears >= experience.required) {
    strengths.push(`Meets ${experience.required}-year experience requirement`);
  } else {
    gaps.push(`Job mentions ${experience.required} year(s); profile has ${applicant.experienceYears}`);
  }
  if (sameLocation) strengths.push('Location matches');
  else if (applicant.willingToRelocate) strengths.push('Applicant is willing to relocate');
  else gaps.push(`Job is in ${job.location}; profile location is ${applicant.location}`);

  if (language.missing.length > 0) gaps.push(`Missing listed language(s): ${language.missing.join(', ')}`);
  else if (job.languages.length > 0) strengths.push('Listed language requirements match');

  if (job.certificateRequired && education < 100) gaps.push('Job requires a certificate-level qualification');
  if (preferences?.minSalaryTzs !== null && preferences?.minSalaryTzs !== undefined && job.salary.monthlyTzs === null) {
    gaps.push('Salary is not stated, so salary preference cannot be verified');
  }

  return {
    score,
    verdict: fitVerdict(score),
    locationPass,
    dimensions,
    strengths,
    gaps,
  };
}
