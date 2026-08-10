import type { Actor, ApplicationEvent, ApplicationStatus } from './types.ts';

/**
 * The status flow from the workflow:
 *
 *   Applied -> Viewed -> Shortlisted -> Interview invited
 *           -> Interview completed -> Hired or Rejected
 *
 * Rejection is reachable from any live state, and the applicant may withdraw at
 * any point before a decision is recorded.
 */
export const STATUS_FLOW: readonly ApplicationStatus[] = [
  'applied',
  'viewed',
  'shortlisted',
  'interview_invited',
  'interview_completed',
];

const ALLOWED_TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  applied: ['viewed', 'shortlisted', 'rejected', 'withdrawn'],
  viewed: ['shortlisted', 'rejected', 'withdrawn'],
  shortlisted: ['interview_invited', 'rejected', 'withdrawn'],
  // An interview can be re-scheduled, which drops back to shortlisted.
  interview_invited: ['interview_completed', 'shortlisted', 'rejected', 'withdrawn'],
  interview_completed: ['hired', 'rejected', 'withdrawn'],
  hired: [],
  rejected: [],
  withdrawn: [],
};

const ACTOR_PERMISSIONS: Record<Actor['kind'], readonly ApplicationStatus[]> = {
  // The agency acts on behalf of employer clients, so it holds the same rights.
  employer: ['viewed', 'shortlisted', 'interview_invited', 'interview_completed', 'hired', 'rejected'],
  agency: ['viewed', 'shortlisted', 'interview_invited', 'interview_completed', 'hired', 'rejected'],
  applicant: ['withdrawn'],
  system: ['viewed'],
};

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  applied: 'Applied',
  viewed: 'Viewed',
  shortlisted: 'Shortlisted',
  interview_invited: 'Interview invited',
  interview_completed: 'Interview completed',
  hired: 'Hired',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
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

export function assertTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
  actorKind: Actor['kind'],
): void {
  const check = canTransition(from, to, actorKind);
  if (!check.ok) throw new TransitionError(from, to, check.reason);
}

/**
 * Every status an application has ever held. Employer counters are built from
 * this rather than the current status: a candidate who is now shortlisted was
 * still viewed, so the "Viewed" tile keeps counting them.
 */
export function reachedStatuses(history: readonly Pick<ApplicationEvent, 'toStatus'>[]): Set<ApplicationStatus> {
  const reached = new Set<ApplicationStatus>();
  for (const event of history) reached.add(event.toStatus);
  return reached;
}

/** Progress index for the applicant's status tracker, -1 for terminal states. */
export function flowPosition(status: ApplicationStatus): number {
  return STATUS_FLOW.indexOf(status);
}
