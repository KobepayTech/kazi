import type { Actor, ApplicationStatus, ApplicationStatusChange } from './types.ts';

/**
 * The MVP status flow:
 *
 *   Applied -> Viewed -> Shortlisted -> Interview -> Hired or Rejected
 *
 * Rejection is reachable from any live stage, and an applicant may withdraw
 * until a decision is recorded.
 */
export const STATUS_FLOW: readonly ApplicationStatus[] = ['applied', 'viewed', 'shortlisted', 'interview'];

const ALLOWED_TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  applied: ['viewed', 'shortlisted', 'rejected', 'withdrawn'],
  viewed: ['shortlisted', 'rejected', 'withdrawn'],
  shortlisted: ['interview', 'hired', 'rejected', 'withdrawn'],
  interview: ['hired', 'rejected', 'withdrawn'],
  hired: [],
  rejected: [],
  withdrawn: [],
};

/** The agency acts for its employer clients, so it holds the same rights. */
const ACTOR_PERMISSIONS: Record<Actor['kind'], readonly ApplicationStatus[]> = {
  employer: ['viewed', 'shortlisted', 'interview', 'hired', 'rejected'],
  agency: ['viewed', 'shortlisted', 'interview', 'hired', 'rejected'],
  applicant: ['withdrawn'],
  system: ['viewed'],
};

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  applied: 'Applied',
  viewed: 'Viewed',
  shortlisted: 'Shortlisted',
  interview: 'Interview',
  hired: 'Hired',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

/** What the applicant is told when their status changes. */
export const STATUS_MESSAGES: Record<ApplicationStatus, string> = {
  applied: 'Your application has been sent.',
  viewed: 'The employer has opened your application.',
  shortlisted: 'You have been shortlisted.',
  interview: 'You have been invited to an interview.',
  hired: 'You have been hired.',
  rejected: 'You were not selected this time.',
  withdrawn: 'You withdrew this application.',
};

export function isTerminal(status: ApplicationStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

export type TransitionCheck = { ok: true } | { ok: false; reason: string };

export function canTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
  actorKind: Actor['kind'],
): TransitionCheck {
  if (from === to) return { ok: false, reason: `Application is already ${STATUS_LABELS[to].toLowerCase()}.` };
  if (isTerminal(from)) {
    return { ok: false, reason: `Application is ${STATUS_LABELS[from].toLowerCase()} and can no longer change.` };
  }
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    return { ok: false, reason: `Cannot move an application from ${STATUS_LABELS[from]} to ${STATUS_LABELS[to]}.` };
  }
  if (!ACTOR_PERMISSIONS[actorKind].includes(to)) {
    return { ok: false, reason: `A ${actorKind} may not set an application to ${STATUS_LABELS[to]}.` };
  }
  return { ok: true };
}

export class TransitionError extends Error {
  readonly code = 'invalid_transition';
  readonly from: ApplicationStatus;
  readonly to: ApplicationStatus;

  constructor(from: ApplicationStatus, to: ApplicationStatus, reason: string) {
    super(reason);
    this.name = 'TransitionError';
    this.from = from;
    this.to = to;
  }
}

export function assertTransition(from: ApplicationStatus, to: ApplicationStatus, actorKind: Actor['kind']): void {
  const check = canTransition(from, to, actorKind);
  if (!check.ok) throw new TransitionError(from, to, check.reason);
}

/**
 * Every status an application has ever held. The employer tiles count from
 * this, so a candidate who has moved on still counts on the earlier tile.
 */
export function reachedStatuses(history: readonly Pick<ApplicationStatusChange, 'toStatus'>[]): Set<ApplicationStatus> {
  const reached = new Set<ApplicationStatus>();
  for (const entry of history) reached.add(entry.toStatus);
  return reached;
}

/** Progress index for the applicant's tracker; -1 once the outcome is known. */
export function flowPosition(status: ApplicationStatus): number {
  return STATUS_FLOW.indexOf(status);
}
