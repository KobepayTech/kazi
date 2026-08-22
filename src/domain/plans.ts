import type { Job, Membership, MembershipPlan } from './types.ts';

/**
 * Soko Huru's three existing packages, seeded for a new tenant. The agency
 * admin can change the names, prices and durations at any time - nothing in
 * the code branches on a plan code, it only reads the flags on the row.
 */
export const DEFAULT_PLANS: ReadonlyArray<Omit<MembershipPlan, 'tenantId'>> = [
  {
    code: 'non_certificate',
    name: 'Jobs without certificates',
    priceTzs: 15_000,
    durationDays: 90,
    coversNonCertificateJobs: true,
    coversCertificateJobs: false,
    active: true,
  },
  {
    code: 'certificate',
    name: 'Jobs requiring certificates',
    priceTzs: 30_000,
    durationDays: 90,
    coversNonCertificateJobs: true,
    coversCertificateJobs: true,
    active: true,
  },
  {
    code: 'special_service',
    name: 'Special Service',
    priceTzs: 50_000,
    durationDays: 180,
    coversNonCertificateJobs: true,
    coversCertificateJobs: true,
    active: true,
  },
];

export type MembershipDenialCode =
  | 'no_membership'
  | 'membership_pending_payment'
  | 'membership_cancelled'
  | 'membership_expired'
  | 'plan_excludes_certificate_jobs'
  | 'plan_excludes_non_certificate_jobs';

export type MembershipCheck =
  | { ok: true; membership: Membership; plan: MembershipPlan }
  | { ok: false; code: MembershipDenialCode; message: string; upgradeTo: MembershipPlan | null };

export function isActive(membership: Membership, now: Date = new Date()): boolean {
  if (membership.status !== 'active') return false;
  if (membership.expiresAt === null) return true;
  return new Date(membership.expiresAt).getTime() > now.getTime();
}

export function expiryFor(activatedAt: Date, plan: MembershipPlan): string {
  const expires = new Date(activatedAt.getTime());
  expires.setUTCDate(expires.getUTCDate() + plan.durationDays);
  return expires.toISOString();
}

export function planCovers(plan: MembershipPlan, job: Pick<Job, 'certificateRequired'>): boolean {
  return job.certificateRequired ? plan.coversCertificateJobs : plan.coversNonCertificateJobs;
}

function cheapestPlanCovering(
  plans: readonly MembershipPlan[],
  job: Pick<Job, 'certificateRequired'>,
): MembershipPlan | null {
  return (
    plans
      .filter((plan) => plan.active && planCovers(plan, job))
      .sort((a, b) => a.priceTzs - b.priceTzs)[0] ?? null
  );
}

/**
 * The membership gate on a right swipe: is there a live membership, and does
 * its plan cover a job of this kind?
 */
export function checkMembership(
  membership: Membership | null,
  plan: MembershipPlan | null,
  job: Pick<Job, 'certificateRequired'>,
  allPlans: readonly MembershipPlan[],
  now: Date = new Date(),
): MembershipCheck {
  const upgradeTo = cheapestPlanCovering(allPlans, job);

  if (membership === null || plan === null) {
    return {
      ok: false,
      code: 'no_membership',
      message: 'You need an active membership before you can apply.',
      upgradeTo,
    };
  }
  if (membership.status === 'pending_payment') {
    return {
      ok: false,
      code: 'membership_pending_payment',
      message: 'Your payment has not been confirmed yet. The agency will activate your membership shortly.',
      upgradeTo: plan,
    };
  }
  if (membership.status === 'cancelled') {
    return { ok: false, code: 'membership_cancelled', message: 'Your membership was cancelled.', upgradeTo };
  }
  if (!isActive(membership, now)) {
    return {
      ok: false,
      code: 'membership_expired',
      message: 'Your membership has expired. Renew it to keep applying.',
      upgradeTo: plan,
    };
  }
  if (job.certificateRequired && !plan.coversCertificateJobs) {
    return {
      ok: false,
      code: 'plan_excludes_certificate_jobs',
      message: `Your ${plan.name} package does not cover jobs that require certificates.`,
      upgradeTo,
    };
  }
  if (!job.certificateRequired && !plan.coversNonCertificateJobs) {
    return {
      ok: false,
      code: 'plan_excludes_non_certificate_jobs',
      message: `Your ${plan.name} package does not cover this job.`,
      upgradeTo,
    };
  }
  return { ok: true, membership, plan };
}

export function daysUntilExpiry(membership: Membership, now: Date = new Date()): number | null {
  if (membership.expiresAt === null) return null;
  return Math.ceil((new Date(membership.expiresAt).getTime() - now.getTime()) / 86_400_000);
}
