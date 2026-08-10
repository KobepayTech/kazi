import type { Store } from '../data/store.ts';
import { daysUntilExpiry, expiryFor, isActive, remainingApplications } from '../domain/membership.ts';
import type { Membership, MembershipPackage } from '../domain/types.ts';
import { AppError } from './errors.ts';
import { EventBus } from './events.ts';

export type MembershipView = {
  membership: Membership | null;
  package: MembershipPackage | null;
  active: boolean;
  daysRemaining: number | null;
  applicationsRemaining: number | null;
};

export type RenewalReminder = {
  membership: Membership;
  applicantId: string;
  applicantName: string;
  phone: string;
  packageName: string;
  daysRemaining: number | null;
  expiresAt: string | null;
};

/**
 * Membership activation, payment confirmation, expiry and renewal reminders.
 * Soko Huru sets the prices and durations; KobeOS enforces them.
 */
export class MembershipService {
  private readonly store: Store;
  private readonly bus: EventBus;

  constructor(store: Store, bus: EventBus) {
    this.store = store;
    this.bus = bus;
  }

  packages(): MembershipPackage[] {
    return this.store.listPackages().filter((pkg) => pkg.active);
  }

  /** Applicant selects a package; it stays pending until payment is confirmed. */
  purchase(applicantId: string, packageCode: string): Membership {
    if (this.store.getApplicant(applicantId) === null) throw AppError.notFound('Applicant not found.');
    const pkg = this.store.getPackage(packageCode);
    if (pkg === null || !pkg.active) throw AppError.badRequest('unknown_package', 'That membership package is not available.');
    const membership = this.store.createMembership({ applicantId, packageCode });
    this.bus.publish('applicant', applicantId, 'membership_pending', {
      membershipId: membership.id,
      packageCode,
      amountDueTzs: pkg.priceTzs,
    });
    return membership;
  }

  /** Payment confirmation from Soko Huru: this is what switches applying on. */
  confirmPayment(membershipId: string, paidAmountTzs: number, paymentReference: string): Membership {
    const membership = this.store.getMembership(membershipId);
    if (membership === null) throw AppError.notFound('Membership not found.');
    const pkg = this.store.getPackage(membership.packageCode);
    if (pkg === null) throw AppError.notFound('Membership package not found.');
    if (membership.status === 'active') {
      throw AppError.conflict('already_active', 'This membership is already active.');
    }
    if (paidAmountTzs < pkg.priceTzs) {
      throw AppError.badRequest(
        'underpaid',
        `${pkg.name} costs TSh ${pkg.priceTzs.toLocaleString('en-US')}. Received TSh ${paidAmountTzs.toLocaleString('en-US')}.`,
      );
    }
    const activated = this.store.activateMembership(
      membershipId,
      paidAmountTzs,
      paymentReference,
      expiryFor(new Date(), pkg),
    );
    this.bus.publish('applicant', membership.applicantId, 'membership_activated', {
      membershipId,
      packageCode: pkg.code,
      packageName: pkg.name,
      expiresAt: activated.expiresAt,
      applicationLimit: pkg.applicationLimit,
    });
    return activated;
  }

  view(applicantId: string): MembershipView {
    const membership = this.store.getActiveMembership(applicantId) ?? this.store.getLatestMembership(applicantId);
    if (membership === null) {
      return { membership: null, package: null, active: false, daysRemaining: null, applicationsRemaining: null };
    }
    const pkg = this.store.getPackage(membership.packageCode);
    return {
      membership,
      package: pkg,
      active: isActive(membership),
      daysRemaining: daysUntilExpiry(membership),
      applicationsRemaining: pkg === null ? null : remainingApplications(membership, pkg),
    };
  }

  /** Flips memberships whose date has passed; run on a schedule or on demand. */
  expireLapsed(): number {
    return this.store.expireLapsedMemberships();
  }

  renewalsDue(withinDays = 7): RenewalReminder[] {
    return this.store.listMembershipsExpiringWithin(withinDays).map((membership) => {
      const applicant = this.store.getApplicant(membership.applicantId);
      const pkg = this.store.getPackage(membership.packageCode);
      return {
        membership,
        applicantId: membership.applicantId,
        applicantName: applicant?.fullName ?? 'Applicant',
        phone: applicant?.phone ?? '',
        packageName: pkg?.name ?? membership.packageCode,
        daysRemaining: daysUntilExpiry(membership),
        expiresAt: membership.expiresAt,
      };
    });
  }

  /** Emits a reminder event per lapsing membership, for SMS or WhatsApp to pick up. */
  sendRenewalReminders(withinDays = 7): RenewalReminder[] {
    const due = this.renewalsDue(withinDays);
    for (const reminder of due) {
      this.bus.publish('applicant', reminder.applicantId, 'membership_renewal_due', {
        membershipId: reminder.membership.id,
        packageName: reminder.packageName,
        daysRemaining: reminder.daysRemaining,
        expiresAt: reminder.expiresAt,
      });
    }
    return due;
  }
}
