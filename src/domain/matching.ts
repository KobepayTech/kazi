import { EDUCATION_ORDER } from './types.ts';
import type {
  Applicant,
  ApplicantPreferences,
  Cv,
  EducationLevel,
  Vacancy,
} from './types.ts';

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

function educationRank(level: EducationLevel): number {
  return EDUCATION_ORDER.indexOf(level);
}

export type FeedFilterReason =
  | 'location'
  | 'category'
  | 'salary_below_minimum'
  | 'salary_above_maximum'
  | 'certificate_preference'
  | 'education_too_high'
  | 'experience_too_high'
  | 'accommodation_required'
  | 'employment_type'
  | 'work_mode'
  | 'gender_neutral_only'
  | 'immediate_start_only';

/**
 * The applicant's own filters, applied before any card is shown. Returns the
 * reasons a vacancy was filtered out; an empty array means "show this card".
 */
export function preferenceMismatches(
  vacancy: Vacancy,
  preferences: ApplicantPreferences | null,
  applicant: Pick<Applicant, 'location'>,
): FeedFilterReason[] {
  if (preferences === null) return [];
  const reasons: FeedFilterReason[] = [];

  if (preferences.locations.length > 0 && !preferences.locations.some((place) => placesMatch(place, vacancy.location))) {
    reasons.push('location');
  }
  if (preferences.categories.length > 0 && !preferences.categories.includes(vacancy.category)) {
    reasons.push('category');
  }
  if (preferences.minSalaryTzs !== null) {
    const monthly = vacancy.salary.monthlyTzs;
    if (monthly === null || monthly < preferences.minSalaryTzs) reasons.push('salary_below_minimum');
  }
  if (preferences.maxSalaryTzs !== null) {
    const monthly = vacancy.salary.monthlyTzs;
    if (monthly !== null && monthly > preferences.maxSalaryTzs) reasons.push('salary_above_maximum');
  }
  if (preferences.certificateRequired !== null && preferences.certificateRequired !== vacancy.certificateRequired) {
    reasons.push('certificate_preference');
  }
  if (
    preferences.educationLevelMax !== null &&
    educationRank(vacancy.educationMin) > educationRank(preferences.educationLevelMax)
  ) {
    reasons.push('education_too_high');
  }
  if (preferences.experienceYearsMax !== null && vacancy.experienceYearsMin > preferences.experienceYearsMax) {
    reasons.push('experience_too_high');
  }
  // "Accommodation required for jobs outside Dar es Salaam" - only bites when the
  // vacancy is away from where the applicant already lives.
  if (
    preferences.accommodationRequiredOutsideHome &&
    !placesMatch(applicant.location, vacancy.location) &&
    !vacancy.accommodationProvided
  ) {
    reasons.push('accommodation_required');
  }
  if (preferences.employmentTypes.length > 0 && !preferences.employmentTypes.includes(vacancy.employmentType)) {
    reasons.push('employment_type');
  }
  if (preferences.workModes.length > 0 && !preferences.workModes.includes(vacancy.workMode)) {
    reasons.push('work_mode');
  }
  if (preferences.genderNeutralOnly && vacancy.genderRequirement !== 'any') {
    reasons.push('gender_neutral_only');
  }
  if (preferences.immediateStartOnly && !vacancy.immediateStart) {
    reasons.push('immediate_start_only');
  }
  if (
    !preferences.willingToRelocate &&
    preferences.locations.length === 0 &&
    !placesMatch(applicant.location, vacancy.location)
  ) {
    reasons.push('location');
  }
  return reasons;
}

export type EligibilityCode =
  | 'vacancy_not_open'
  | 'positions_filled'
  | 'deadline_passed'
  | 'gender_requirement'
  | 'age_requirement'
  | 'already_applied';

export type EligibilityFailure = { code: EligibilityCode; message: string };

export function ageOf(dateOfBirth: string | null, now: Date = new Date()): number | null {
  if (dateOfBirth === null) return null;
  const born = new Date(dateOfBirth);
  if (Number.isNaN(born.getTime())) return null;
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - born.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < born.getUTCDate())) age -= 1;
  return age;
}

/**
 * Hard gates set by the employer client's own vacancy requirements. These both
 * hide the card from the feed and refuse the application, so an applicant never
 * spends an application on a vacancy they cannot be considered for.
 */
export function eligibilityFailures(
  vacancy: Vacancy,
  applicant: Applicant,
  context: { hiredCount: number; alreadyApplied?: boolean; now?: Date },
): EligibilityFailure[] {
  const now = context.now ?? new Date();
  const failures: EligibilityFailure[] = [];

  if (vacancy.status !== 'published') {
    failures.push({ code: 'vacancy_not_open', message: 'This vacancy is no longer open.' });
  }
  if (context.hiredCount >= vacancy.positions) {
    failures.push({ code: 'positions_filled', message: 'All positions for this vacancy have been filled.' });
  }
  if (vacancy.applicationDeadline !== null) {
    const deadline = new Date(vacancy.applicationDeadline);
    if (!Number.isNaN(deadline.getTime()) && deadline.getTime() < now.getTime()) {
      failures.push({ code: 'deadline_passed', message: 'The closing date for this vacancy has passed.' });
    }
  }
  if (vacancy.genderRequirement !== 'any' && applicant.gender !== vacancy.genderRequirement) {
    failures.push({
      code: 'gender_requirement',
      message: `The employer has asked for ${vacancy.genderRequirement} candidates for this role.`,
    });
  }
  const age = ageOf(applicant.dateOfBirth, now);
  if (age !== null) {
    if (vacancy.ageMin !== null && age < vacancy.ageMin) {
      failures.push({ code: 'age_requirement', message: `This vacancy is for candidates aged ${vacancy.ageMin} and above.` });
    } else if (vacancy.ageMax !== null && age > vacancy.ageMax) {
      failures.push({ code: 'age_requirement', message: `This vacancy is for candidates up to age ${vacancy.ageMax}.` });
    }
  }
  if (context.alreadyApplied) {
    failures.push({ code: 'already_applied', message: 'You have already applied for this vacancy.' });
  }
  return failures;
}

export type MatchComponent = {
  component: string;
  weight: number;
  earned: number;
  reason: string;
};

export type MatchResult = {
  score: number;
  components: MatchComponent[];
  reasons: string[];
};

const WEIGHTS = {
  category: 25,
  location: 20,
  salary: 15,
  experience: 15,
  language: 10,
  availability: 10,
  education: 5,
} as const;

function overlap(a: readonly string[], b: readonly string[]): string[] {
  const lower = new Set(b.map((value) => value.toLowerCase()));
  return a.filter((value) => lower.has(value.toLowerCase()));
}

/**
 * The 0-100 "Match score: 91%" the employer sees next to each applicant card.
 * Every component reports why it scored what it did, so the number is
 * explainable to both the employer and the applicant.
 */
export function scoreMatch(
  vacancy: Vacancy,
  applicant: Applicant,
  cv: Cv,
  preferences: ApplicantPreferences | null = null,
): MatchResult {
  const components: MatchComponent[] = [];
  const reasons: string[] = [];

  const categoryHit = cv.categories.includes(vacancy.category);
  components.push({
    component: 'category',
    weight: WEIGHTS.category,
    earned: categoryHit ? 1 : cv.categories.length === 0 ? 0.5 : 0.25,
    reason: categoryHit ? `CV covers ${vacancy.category.replace(/_/g, ' ')}` : 'CV is from a different job family',
  });
  if (categoryHit) reasons.push(`${vacancy.category.replace(/_/g, ' ')} background`);

  const samePlace = placesMatch(applicant.location, vacancy.location);
  const locationEarned = samePlace ? 1 : applicant.willingToRelocate ? 0.65 : 0.2;
  components.push({
    component: 'location',
    weight: WEIGHTS.location,
    earned: locationEarned,
    reason: samePlace
      ? `Already in ${vacancy.location}`
      : applicant.willingToRelocate
        ? `Based in ${applicant.location}, willing to relocate`
        : `Based in ${applicant.location}, not willing to relocate`,
  });
  if (samePlace) reasons.push(`Based in ${vacancy.location}`);
  else if (applicant.willingToRelocate) reasons.push('Willing to relocate');

  const expected = cv.preferredSalaryTzs ?? preferences?.minSalaryTzs ?? null;
  const offered = vacancy.salary.monthlyTzs;
  let salaryEarned = 0.8;
  let salaryReason = 'No salary expectation recorded';
  if (expected !== null && offered !== null) {
    if (offered >= expected) {
      salaryEarned = 1;
      salaryReason = 'Offer meets salary expectation';
    } else if (offered >= expected * 0.8) {
      salaryEarned = 0.6;
      salaryReason = 'Offer is slightly below salary expectation';
    } else {
      salaryEarned = 0.2;
      salaryReason = 'Offer is well below salary expectation';
    }
  }
  components.push({ component: 'salary', weight: WEIGHTS.salary, earned: salaryEarned, reason: salaryReason });

  const required = vacancy.experienceYearsMin;
  let experienceEarned = 1;
  if (required > 0) {
    if (cv.experienceYears >= required) experienceEarned = 1;
    else if (cv.experienceYears >= required - 1) experienceEarned = 0.6;
    else experienceEarned = Math.max(0.1, cv.experienceYears / Math.max(required, 1));
  }
  components.push({
    component: 'experience',
    weight: WEIGHTS.experience,
    earned: experienceEarned,
    reason: `${cv.experienceYears} year(s) experience against ${required} required`,
  });
  if (cv.experienceYears > 0) reasons.push(`${cv.experienceYears} year(s) experience`);

  const cvLanguages = cv.languages.length > 0 ? cv.languages : applicant.languages;
  const shared = overlap(vacancy.languages, cvLanguages);
  const languageEarned = vacancy.languages.length === 0 ? 1 : shared.length / vacancy.languages.length;
  components.push({
    component: 'language',
    weight: WEIGHTS.language,
    earned: languageEarned,
    reason:
      vacancy.languages.length === 0
        ? 'No language requirement'
        : `Speaks ${shared.length}/${vacancy.languages.length} required language(s)`,
  });
  if (shared.length > 0) reasons.push(`Speaks ${shared.join(' and ')}`);

  const availableNow =
    applicant.availableFrom === null || new Date(applicant.availableFrom).getTime() <= Date.now();
  const availabilityEarned = vacancy.immediateStart ? (availableNow ? 1 : 0.4) : availableNow ? 1 : 0.8;
  components.push({
    component: 'availability',
    weight: WEIGHTS.availability,
    earned: availabilityEarned,
    reason: availableNow ? 'Available immediately' : `Available from ${applicant.availableFrom}`,
  });
  if (availableNow) reasons.push('Available immediately');

  const educationGap = educationRank(cv.educationLevel) - educationRank(vacancy.educationMin);
  const educationEarned = educationGap >= 0 ? 1 : educationGap === -1 ? 0.5 : 0.1;
  components.push({
    component: 'education',
    weight: WEIGHTS.education,
    earned: educationEarned,
    reason: `${cv.educationLevel} against ${vacancy.educationMin} required`,
  });

  const total = components.reduce((sum, part) => sum + part.weight * part.earned, 0);
  const maxTotal = components.reduce((sum, part) => sum + part.weight, 0);
  return {
    score: Math.round((total / maxTotal) * 100),
    components,
    reasons,
  };
}

/** Step 3 of the right-swipe pipeline: pick the applicant's most relevant CV. */
export function selectBestCv(
  vacancy: Vacancy,
  applicant: Applicant,
  cvs: readonly Cv[],
  preferences: ApplicantPreferences | null = null,
): { cv: Cv; match: MatchResult } | null {
  if (cvs.length === 0) return null;
  let best: { cv: Cv; match: MatchResult } | null = null;
  for (const cv of cvs) {
    const match = scoreMatch(vacancy, applicant, cv, preferences);
    if (
      best === null ||
      match.score > best.match.score ||
      // Ties go to the CV the applicant marked as their default.
      (match.score === best.match.score && cv.isDefault && !best.cv.isDefault)
    ) {
      best = { cv, match };
    }
  }
  return best;
}
