import type { JobDraft, TenantStore } from '../data/store.ts';
import type { AgencyOverviewRow, Applicant, Employer, JobStats, Membership, MembershipPlan, Payment } from '../domain/types.ts';
import type { AccessService, IssuedSecret } from './access.ts';
import { AppError } from './errors.ts';
import { AGENCY_SCOPE_ID, EventBus } from './events.ts';

export type QueuedDraft = {
  draft: JobDraft;
  employerName: string | null;
  /** Whether the agency uploaded it or the client typed it themselves. */
  source: 'employer_form' | 'agency_upload';
};

export type ClientRow = {
  employer: Employer;
  employerLink: string;
  jobs: JobStats[];
  applications: number;
  newApplications: number;
  lastSeenAt: string | null;
};

export type SubscriberStatus = 'active' | 'pending_payment' | 'expired' | 'unsubscribed';

export type SubscriberRow = {
  applicant: Applicant;
  membership: Membership | null;
  plan: MembershipPlan | null;
  latestPayment: Payment | null;
  status: SubscriberStatus;
  expiresAt: string | null;
};

export type SubscriberSummary = {
  registered: number;
  active: number;
  pendingPayment: number;
  expired: number;
  unsubscribed: number;
};

/**
 * The agency's admin view: every client, every job, and the two things staff
 * do by hand in the MVP - confirming payments and resending employer access.
 */
export class AgencyService {
  private readonly store: TenantStore;
  private readonly bus: EventBus;
  private readonly access: AccessService;
  private readonly linkFor: (accessCode: string) => string;

  constructor(
    store: TenantStore,
    bus: EventBus,
    access: AccessService,
    linkFor: (accessCode: string) => string,
  ) {
    this.store = store;
    this.bus = bus;
    this.access = access;
    this.linkFor = linkFor;
  }

  overview(): AgencyOverviewRow[] {
    return this.store.agencyOverview();
  }

  drafts(status?: JobDraft['status']): JobDraft[] {
    return this.store.listDrafts(status);
  }

  /**
   * Everything waiting for staff to publish, whether the agency uploaded a
   * poster or the client typed the vacancy into their own page.
   */
  reviewQueue(): QueuedDraft[] {
    return this.store
      .listDrafts()
      .filter((draft) => draft.status === 'extracted' || draft.status === 'reviewed')
      .map((draft) => ({
        draft,
        employerName:
          (draft.employerId === null ? null : this.store.getEmployer(draft.employerId)?.name ?? null) ??
          draft.employerNameGuess,
        source: draft.intakeChannel === 'employer_form' ? 'employer_form' : 'agency_upload',
      }));
  }

  clients(): ClientRow[] {
    return this.store.listEmployers().map((employer) => {
      const jobs = this.store.employerStats(employer.id);
      return {
        employer,
        employerLink: this.linkFor(employer.accessCode),
        jobs,
        applications: jobs.reduce((sum, stats) => sum + stats.applications, 0),
        newApplications: jobs.reduce((sum, stats) => sum + stats.newApplications, 0),
        lastSeenAt: employer.lastSeenAt,
      };
    });
  }

  client(employerId: string): ClientRow {
    const row = this.clients().find((candidate) => candidate.employer.id === employerId);
    if (row === undefined) throw AppError.notFound('Employer client not found.');
    return row;
  }

  /** Issues a fresh access code for a client and shows it to staff once. */
  resendAccess(employerId: string): IssuedSecret & { employerLink: string } {
    const employer = this.store.getEmployer(employerId);
    if (employer === null) throw AppError.notFound('Employer client not found.');
    const issued = this.access.issueAccessCode(employerId);
    this.bus.publish('agency', AGENCY_SCOPE_ID, 'employer_access_issued', {
      employerId,
      employerName: employer.name,
      expiresAt: issued.expiresAt,
    });
    return { ...issued, employerLink: this.linkFor(employer.accessCode) };
  }

  applicants(): Applicant[] {
    return this.store.listApplicants();
  }

  subscribers(): { summary: SubscriberSummary; subscribers: SubscriberRow[] } {
    const payments = this.store.listPayments();
    const now = Date.now();
    const subscribers = this.store.listApplicants().map((applicant): SubscriberRow => {
      const membership = this.store.getLatestMembership(applicant.id);
      const plan = membership === null ? null : this.store.getPlan(membership.planCode);
      const latestPayment = membership === null
        ? null
        : payments.find((payment) => payment.membershipId === membership.id) ?? null;

      let status: SubscriberStatus = 'unsubscribed';
      if (membership !== null) {
        if (membership.status === 'pending_payment') status = 'pending_payment';
        else if (
          membership.status === 'active' &&
          (membership.expiresAt === null || new Date(membership.expiresAt).getTime() > now)
        ) status = 'active';
        else status = 'expired';
      }

      return {
        applicant,
        membership,
        plan,
        latestPayment,
        status,
        expiresAt: membership?.expiresAt ?? null,
      };
    });

    return {
      summary: {
        registered: subscribers.length,
        active: subscribers.filter((entry) => entry.status === 'active').length,
        pendingPayment: subscribers.filter((entry) => entry.status === 'pending_payment').length,
        expired: subscribers.filter((entry) => entry.status === 'expired').length,
        unsubscribed: subscribers.filter((entry) => entry.status === 'unsubscribed').length,
      },
      subscribers,
    };
  }

  pendingPayments(): (Payment & { applicantName: string; planName: string })[] {
    return this.store.listPayments('submitted').map((payment) => ({
      ...payment,
      applicantName: this.store.getApplicant(payment.applicantId)?.fullName ?? payment.applicantId,
      planName: this.store.getPlan(this.store.getMembership(payment.membershipId)?.planCode ?? '')?.name ?? 'Membership',
    }));
  }

  /** Totals for the top of the admin page. */
  summary(): { clients: number; jobs: number; applications: number; shortlisted: number; hired: number } {
    const rows = this.overview();
    return {
      clients: new Set(rows.map((row) => row.employerId)).size,
      jobs: rows.length,
      applications: rows.reduce((sum, row) => sum + row.applications, 0),
      shortlisted: rows.reduce((sum, row) => sum + row.shortlisted, 0),
      hired: rows.reduce((sum, row) => sum + row.hired, 0),
    };
  }
}
