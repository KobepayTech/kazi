import type { JobCategory, Membership, MembershipPackage, Vacancy } from './types.ts';

/**
 * Soko Huru's published packages. These are seeded into the database and edited
 * from the agency console - the code never branches on a package code, it only
 * reads the flags on the row, so Soko Huru can rename, reprice or add packages
 * without a deployment.
 */
export const DEFAULT_PACKAGES: readonly MembershipPackage[] = [
  {
    code: 'non_certificate',
    name: 'Jobs not requiring certificates',
    priceTzs: 15_000,
    durationDays: 90,
    coversNonCertificateJobs: true,
    coversCertificateJobs: false,
    applicationLimit: 30,
    categories: null,
    priorityReview: false,
    active: true,
  },
  {
    code: 'certificate',
    name: 'Jobs requiring certificates',
    priceTzs: 30_000,
    durationDays: 90,
    coversNonCertificateJobs: true,
    coversCertificateJobs: true,
    applicationLimit: 60,
    categories: null,
    priorityReview: false,
    active: true,
  },
  {
    code: 'special_service',
    name: 'Special Service',
    priceTzs: 50_000,
    durationDays: 180,
    coversNonCertificateJobs: true,
    coversCertificateJobs: true,
    applicationLimit: null,
    categories: null,
    priorityReview: true,
    active: true,
  },
];

export type MembershipDenialCode =
  | 'no_membership'
  | 'membership_pending_payment'
  | 'membership_cancelled'
  | 'membership_expired'
  | 'package_excludes_certificate_jobs'
  | 'package_excludes_non_certificate_jobs'
  | 'package_excludes_category'
  | 'application_limit_reached';

export type MembershipCheck =
  | { ok: true; membership: Membership; package: MembershipPackage }
  | { ok: false; code: MembershipDenialCode; message: string; upgradeTo: MembershipPackage | null };

export function isActive(membership: Membership, now: Date = new Date()): boolean {
  if (membership.status !== 'active') return false;
  if (membership.expiresAt === null) return true;
  return new Date(membership.expiresAt).getTime() > now.getTime();
}

export function expiryFor(activatedAt: Date, pkg: MembershipPackage): string {
  const expires = new Date(activatedAt.getTime());
  expires.setUTCDate(expires.getUTCDate() + pkg.durationDays);
  return expires.toISOString();
}

export function remainingApplications(membership: Membership, pkg: MembershipPackage): number | null {
  if (pkg.applicationLimit === null) return null;
  return Math.max(0, pkg.applicationLimit - membership.applicationsUsed);
}

/** True when the package covers a vacancy of this shape. */
export function packageCovers(pkg: MembershipPackage, vacancy: Pick<Vacancy, 'certificateRequired' | 'category'>): boolean {
  if (vacancy.certificateRequired && !pkg.coversCertificateJobs) return false;
  if (!vacancy.certificateRequired && !pkg.coversNonCertificateJobs) return false;
  if (pkg.categories !== null && !pkg.categories.includes(vacancy.category)) return false;
  return true;
}

function cheapestPackageCovering(
  packages: readonly MembershipPackage[],
  vacancy: Pick<Vacancy, 'certificateRequired' | 'category'>,
): MembershipPackage | null {
  const candidates = packages
    .filter((pkg) => pkg.active && packageCovers(pkg, vacancy))
    .sort((a, b) => a.priceTzs - b.priceTzs);
  return candidates[0] ?? null;
}

/**
 * Steps 1 and 2 of the right-swipe pipeline: does this applicant hold a live
 * Soko Huru membership, and does that membership cover this kind of vacancy?
 */
export function checkMembership(
  membership: Membership | null,
  pkg: MembershipPackage | null,
  vacancy: Pick<Vacancy, 'certificateRequired' | 'category'>,
  allPackages: readonly MembershipPackage[],
  now: Date = new Date(),
): MembershipCheck {
  const upgradeTo = cheapestPackageCovering(allPackages, vacancy);

  if (membership === null || pkg === null) {
    return {
      ok: false,
      code: 'no_membership',
      message: 'You need an active Soko Huru membership before you can apply.',
      upgradeTo,
    };
  }
  if (membership.status === 'pending_payment') {
    return {
      ok: false,
      code: 'membership_pending_payment',
      message: 'Your membership payment has not been confirmed yet.',
      upgradeTo: pkg,
    };
  }
  if (membership.status === 'cancelled') {
    return { ok: false, code: 'membership_cancelled', message: 'Your membership was cancelled.', upgradeTo };
  }
  if (!isActive(membership, now)) {
    return {
      ok: false,
      code: 'membership_expired',
      message: 'Your Soko Huru membership has expired. Renew it to keep applying.',
      upgradeTo: pkg,
    };
  }
  if (vacancy.certificateRequired && !pkg.coversCertificateJobs) {
    return {
      ok: false,
      code: 'package_excludes_certificate_jobs',
      message: `Your ${pkg.name} package does not cover jobs that require certificates.`,
      upgradeTo,
    };
  }
  if (!vacancy.certificateRequired && !pkg.coversNonCertificateJobs) {
    return {
      ok: false,
      code: 'package_excludes_non_certificate_jobs',
      message: `Your ${pkg.name} package does not cover this vacancy.`,
      upgradeTo,
    };
  }
  if (pkg.categories !== null && !pkg.categories.includes(vacancy.category)) {
    return {
      ok: false,
      code: 'package_excludes_category',
      message: `Your ${pkg.name} package does not cover ${vacancy.category.replace(/_/g, ' ')} vacancies.`,
      upgradeTo,
    };
  }
  const remaining = remainingApplications(membership, pkg);
  if (remaining !== null && remaining <= 0) {
    return {
      ok: false,
      code: 'application_limit_reached',
      message: `You have used all ${pkg.applicationLimit} applications on your ${pkg.name} package.`,
      upgradeTo: allPackages.find((candidate) => candidate.applicationLimit === null && candidate.active) ?? null,
    };
  }
  return { ok: true, membership, package: pkg };
}

/** Days until expiry, used to decide when to send a renewal reminder. */
export function daysUntilExpiry(membership: Membership, now: Date = new Date()): number | null {
  if (membership.expiresAt === null) return null;
  const millis = new Date(membership.expiresAt).getTime() - now.getTime();
  return Math.ceil(millis / 86_400_000);
}

export function renewalReminderDue(membership: Membership, withinDays = 7, now: Date = new Date()): boolean {
  if (membership.status !== 'active') return false;
  const days = daysUntilExpiry(membership, now);
  return days !== null && days <= withinDays && days >= 0;
}

export function categoriesCovered(pkg: MembershipPackage, all: readonly JobCategory[]): readonly JobCategory[] {
  return pkg.categories ?? all;
}
