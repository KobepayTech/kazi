import { formatSalaryLine } from './salary.ts';
import type { Job, JobCard } from './types.ts';

/** The bullet lines under the pay on the swipe card. */
export function cardHighlights(job: Job): string[] {
  const highlights: string[] = [];
  if (job.accommodationProvided) highlights.push('Accommodation provided');
  if (job.immediateStart) highlights.push('Immediate start');
  if (job.languages.length > 0) highlights.push(`${job.languages.join(' and ')} required`);
  if (job.experienceNote !== null) highlights.push(job.experienceNote);
  if (job.certificateRequired) highlights.push('Certificate required');
  if (job.applicationDeadline !== null) highlights.push(`Apply before ${job.applicationDeadline}`);
  return highlights;
}

export function positionsLine(positions: number, remaining?: number): string {
  const count = remaining ?? positions;
  return count === 1 ? '1 position' : `${count} positions`;
}

export function buildJobCard(
  job: Job,
  options: { employerName: string; agencyName: string; remainingPositions?: number; saved?: boolean },
): JobCard {
  return {
    jobId: job.id,
    title: job.title,
    location: job.location,
    salaryLine: formatSalaryLine(job.salary),
    positionsLine: positionsLine(job.positions, options.remainingPositions),
    highlights: cardHighlights(job),
    employerName: options.employerName,
    postedThrough: `Posted through ${options.agencyName}`,
    sourceImagePath: job.sourceImagePath,
    saved: options.saved ?? false,
  };
}
