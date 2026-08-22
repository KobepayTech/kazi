import type { Applicant, ApplicantPreferences, Job } from './types.ts';

function normalisePlace(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** "Zanzibar" matches "Zanzibar (Nungwi)"; "Dar es Salaam" matches "dar-es-salaam". */
export function placesMatch(a: string, b: string): boolean {
  const left = normalisePlace(a);
  const right = normalisePlace(b);
  if (left.length === 0 || right.length === 0) return false;
  return left === right || left.includes(right) || right.includes(left);
}

/** The four filters the MVP ships with. */
export type FilterReason = 'location' | 'category' | 'salary_below_minimum' | 'certificate_preference';

/**
 * The applicant's own filters. An empty result means "put this card in the
 * deck". Preferences left blank do not filter anything out.
 */
export function filterReasons(job: Job, preferences: ApplicantPreferences | null): FilterReason[] {
  if (preferences === null) return [];
  const reasons: FilterReason[] = [];

  if (preferences.locations.length > 0 && !preferences.locations.some((place) => placesMatch(place, job.location))) {
    reasons.push('location');
  }
  if (preferences.categories.length > 0 && !preferences.categories.includes(job.category)) {
    reasons.push('category');
  }
  if (preferences.minSalaryTzs !== null) {
    const monthly = job.salary.monthlyTzs;
    if (monthly === null || monthly < preferences.minSalaryTzs) reasons.push('salary_below_minimum');
  }
  if (preferences.certificateRequired !== null && preferences.certificateRequired !== job.certificateRequired) {
    reasons.push('certificate_preference');
  }
  return reasons;
}

export type EligibilityCode = 'job_not_open' | 'positions_filled' | 'deadline_passed' | 'already_applied';

export type EligibilityFailure = { code: EligibilityCode; message: string };

/**
 * Whether this job can still take an application at all. Kept deliberately
 * small for the MVP: open, unfilled, in date, and not already applied to.
 */
export function eligibilityFailures(
  job: Job,
  context: { hiredCount: number; alreadyApplied?: boolean; now?: Date },
): EligibilityFailure[] {
  const now = context.now ?? new Date();
  const failures: EligibilityFailure[] = [];

  if (job.status !== 'published') {
    failures.push({ code: 'job_not_open', message: 'This job is no longer open.' });
  }
  if (context.hiredCount >= job.positions) {
    failures.push({ code: 'positions_filled', message: 'All positions for this job have been filled.' });
  }
  if (job.applicationDeadline !== null) {
    const deadline = new Date(job.applicationDeadline);
    if (!Number.isNaN(deadline.getTime()) && deadline.getTime() < now.getTime()) {
      failures.push({ code: 'deadline_passed', message: 'The closing date for this job has passed.' });
    }
  }
  if (context.alreadyApplied) {
    failures.push({ code: 'already_applied', message: 'You have already applied for this job.' });
  }
  return failures;
}

/** Newest first - the MVP does not rank candidates or jobs by score. */
export function byNewest(a: Job, b: Job): number {
  return (b.publishedAt ?? b.createdAt).localeCompare(a.publishedAt ?? a.createdAt);
}

export function relocationNote(applicant: Applicant, job: Job): string | null {
  if (placesMatch(applicant.location, job.location)) return null;
  return applicant.willingToRelocate ? 'Ready to relocate' : 'Would need to relocate';
}
