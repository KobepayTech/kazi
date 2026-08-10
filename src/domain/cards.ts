import { AGENCY_NAME } from '../config.ts';
import { formatSalaryLine } from './salary.ts';
import type { JobCard, Vacancy } from './types.ts';
import type { MatchResult } from './matching.ts';

const EMPLOYMENT_LABELS: Record<Vacancy['employmentType'], string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  casual: 'Casual',
  internship: 'Internship',
};

const WORK_MODE_LABELS: Record<Vacancy['workMode'], string> = {
  onsite: 'On site',
  remote: 'Remote',
  hybrid: 'Hybrid',
};

/** The bullet lines under the salary on the swipe card. */
export function cardHighlights(vacancy: Vacancy): string[] {
  const highlights: string[] = [];
  if (vacancy.accommodationProvided) highlights.push('Accommodation provided');
  if (vacancy.mealsProvided) highlights.push('Meals provided');
  if (vacancy.transportProvided) highlights.push('Transport provided');
  if (vacancy.immediateStart) highlights.push('Immediate start');
  else if (vacancy.startDate !== null) highlights.push(`Starts ${vacancy.startDate}`);
  if (vacancy.languages.length > 0) highlights.push(`${vacancy.languages.join(' and ')} required`);
  if (vacancy.experienceNote !== null) highlights.push(vacancy.experienceNote);
  else if (vacancy.experienceYearsMin > 0) highlights.push(`${vacancy.experienceYearsMin}+ years experience`);
  if (vacancy.certificateRequired) highlights.push('Certificate required');
  if (vacancy.employmentType !== 'full_time') highlights.push(EMPLOYMENT_LABELS[vacancy.employmentType]);
  if (vacancy.workMode !== 'onsite') highlights.push(WORK_MODE_LABELS[vacancy.workMode]);
  if (vacancy.ageMin !== null && vacancy.ageMax !== null) highlights.push(`Age ${vacancy.ageMin}-${vacancy.ageMax}`);
  return highlights;
}

export function positionsLine(positions: number, remaining?: number): string {
  const count = remaining ?? positions;
  return count === 1 ? '1 position available' : `${count} positions available`;
}

/** Turns a published vacancy into the Tinder-style card the applicant swipes. */
export function buildJobCard(
  vacancy: Vacancy,
  match: MatchResult,
  options: { remainingPositions?: number; agencyName?: string } = {},
): JobCard {
  return {
    vacancyId: vacancy.id,
    title: vacancy.title,
    location: vacancy.location,
    salaryLine: formatSalaryLine(vacancy.salary),
    positionsLine: positionsLine(vacancy.positions, options.remainingPositions),
    highlights: cardHighlights(vacancy),
    postedThrough: `Posted through ${options.agencyName ?? AGENCY_NAME}`,
    matchScore: match.score,
    matchReasons: match.reasons,
    sourceImagePath: vacancy.sourceImagePath,
    actions: {
      right: 'apply',
      left: 'skip',
      up: 'save',
      tap: 'view_details',
    },
  };
}
