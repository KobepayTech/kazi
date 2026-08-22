import type { TenantStore } from '../data/store.ts';
import { DEFAULT_PLANS, daysUntilExpiry, expiryFor, isActive } from '../domain/plans.ts';
import type { Membership, MembershipPlan, Payment } from '../domain/types.ts';
import { AppError } from './errors.ts';
import { AGENCY_SCOPE_ID, EventBus } from './events.ts';

export type MembershipView = {
  membership: Membership | null;
  plan: MembershipPlan | null;
  active: boolean;
  daysRemaining: number | null;
  pendingPayment: Payment | null;
};

/**
 * MVP payments: the applicant pays by mobile money, submits the transaction
 * reference, and the agency confirms it. Confirmation is what starts the
 * membership. Automatic reconciliation comes later.
 */
export class MembershipService {
  private readonly store: TenantStore;
  private readonly bus: EventBus;

  constructor(store: TenantStore, bus: EventBus) {
    this.store = store;
    this.bus = bus;
  }

  /** Seeds the agency's three packages on a new tenant. */
  seedDefaultPlans(): MembershipPlan[] {
    return DEFAULT_PLANS.map((plan) => this.store.upsertPlan(plan));
  }

  plans(): MembershipPlan[] {
    return this.store.listPlans().filter((plan) => plan.active);
  }

  allPlans(): MembershipPlan[] {
    return this.store.listPlans();
  }

  /** The agency admin changing a price, a name or a duration. */
  savePlan(plan: Omit<MembershipPlan, 'tenantId'>): MembershipPlan {
    if (plan.priceTzs < 0) throw AppError.badRequest('invalid_price', 'A price cannot be negative.');
    if (plan.durationDays <= 0) throw AppError.badRequest('invalid_duration', 'A package must last at least one day.');
    return this.store.upsertPlan(plan);
  }

  /**
   * Records the applicant's payment claim. The membership exists immediately
   * but stays pending until the agency confirms the reference.
   */
  submitPayment(input: {
    applicantId: string;
    planCode: string;
    amountTzs: number;
    reference: string;
    method?: string;
  }): { membership: Membership; payment: Payment; plan: MembershipPlan } {
    if (this.store.getApplicant(input.applicantId) === null) throw AppError.notFound('Applicant not found.');
    const plan = this.store.getPlan(input.planCode);
    if (plan === null || !plan.active) {
      throw AppError.badRequest('unknown_plan', 'That membership package is not available.');
    }
    if (this.store.findPaymentByReference(input.reference) !== null) {
      throw AppError.conflict('duplicate_reference', 'That transaction reference has already been submitted.');
    }

    const { membership, payment } = this.store.transaction(() => {
      const created = this.store.createMembership(input.applicantId, plan.code);
      const recorded = this.store.createPayment({
        applicantId: input.applicantId,
        membershipId: created.id,
        amountTzs: input.amountTzs,
        reference: input.reference,
        method: input.method ?? 'mobile_money',
      });
      return { membership: created, payment: recorded };
    });

    const applicant = this.store.getApplicant(input.applicantId);
    this.bus.publish('agency', AGENCY_SCOPE_ID, 'payment_submitted', {
      paymentId: payment.id,
      applicantId: input.applicantId,
      applicantName: applicant?.fullName ?? input.applicantId,
      planName: plan.name,
      amountTzs: payment.amountTzs,
      reference: payment.reference,
    });
    this.bus.publish('applicant', input.applicantId, 'payment_submitted', {
      paymentId: payment.id,
      planName: plan.name,
      amountTzs: payment.amountTzs,
    });

    return { membership, payment, plan };
  }

  /** Agency staff confirming money received. This is what switches applying on. */
  confirmPayment(paymentId: string, staffId: string): { payment: Payment; membership: Membership } {
    const payment = this.store.getPayment(paymentId);
    if (payment === null) throw AppError.notFound('Payment not found.');
    if (payment.status === 'confirmed') throw AppError.conflict('already_confirmed', 'That payment is already confirmed.');

    const membership = this.store.getMembership(payment.membershipId);
    if (membership === null) throw AppError.notFound('Membership not found.');
    const plan = this.store.getPlan(membership.planCode);
    if (plan === null) throw AppError.notFound('Membership package not found.');
    if (payment.amountTzs < plan.priceTzs) {
      throw AppError.badRequest(
        'underpaid',
        `${plan.name} costs TSh ${plan.priceTzs.toLocaleString('en-US')}. This payment was TSh ${payment.amountTzs.toLocaleString('en-US')}.`,
      );
    }

    const result = this.store.transaction(() => ({
      payment: this.store.reviewPayment(paymentId, 'confirmed', staffId, null),
      membership: this.store.activateMembership(membership.id, expiryFor(new Date(), plan)),
    }));

    this.bus.publish('applicant', payment.applicantId, 'membership_activated', {
      membershipId: membership.id,
      planName: plan.name,
      expiresAt: result.membership.expiresAt,
    });
    return result;
  }

  rejectPayment(paymentId: string, staffId: string, note: string): Payment {
    const payment = this.store.getPayment(paymentId);
    if (payment === null) throw AppError.notFound('Payment not found.');
    if (payment.status === 'confirmed') {
      throw AppError.conflict('already_confirmed', 'That payment is already confirmed.');
    }
    const rejected = this.store.reviewPayment(paymentId, 'rejected', staffId, note);
    this.bus.publish('applicant', payment.applicantId, 'payment_rejected', {
      paymentId,
      reference: payment.reference,
      note,
    });
    return rejected;
  }

  pendingPayments(): Payment[] {
    return this.store.listPayments('submitted');
  }

  view(applicantId: string): MembershipView {
    const membership = this.store.getActiveMembership(applicantId) ?? this.store.getLatestMembership(applicantId);
    if (membership === null) {
      return { membership: null, plan: null, active: false, daysRemaining: null, pendingPayment: null };
    }
    const pending = this.store
      .listPayments('submitted')
      .find((payment) => payment.membershipId === membership.id) ?? null;
    return {
      membership,
      plan: this.store.getPlan(membership.planCode),
      active: isActive(membership),
      daysRemaining: daysUntilExpiry(membership),
      pendingPayment: pending,
    };
  }

  expireLapsed(): number {
    return this.store.expireLapsedMemberships();
  }
}
