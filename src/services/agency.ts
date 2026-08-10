import type { Store, VacancyDraft } from '../data/store.ts';
import type {
  AccessGrantKind,
  AgencyOverviewRow,
  Applicant,
  Employer,
  JobCategory,
  Vacancy,
  VacancyStats,
} from '../domain/types.ts';
import type { AccessService, IssuedSecret } from './access.ts';
import { AppError } from './errors.ts';
import { AGENCY_SCOPE_ID, EventBus } from './events.ts';

export type ClientRow = {
  employer: Employer;
  portalUrl: string | null;
  vacancies: VacancyStats[];
  applications: number;
  newApplications: number;
  lastSeenAt: string | null;
  /** True when candidates are waiting and the client has not opened the page. */
  needsChasing: boolean;
};

export type RecruitmentReport = {
  generatedAt: string;
  totals: {
    clients: number;
    vacancies: number;
    positions: number;
    applications: number;
    shortlisted: number;
    interviewInvited: number;
    hired: number;
    remainingPositions: number;
  };
  byClient: ClientRow[];
  unreviewedByClient: { employerName: string; unreviewed: number; lastSeenAt: string | null }[];
};

/**
 * The Soko Huru control dashboard: every client, every vacancy, live counts,
 * plus the agency-side actions - resending employer access, registering
 * applicants, and acting on an employer's behalf.
 */
export class AgencyService {
  private readonly store: Store;
  private readonly bus: EventBus;
  private readonly access: AccessService;

  constructor(store: Store, bus: EventBus, access: AccessService) {
    this.store = store;
    this.bus = bus;
    this.access = access;
  }

  overview(): AgencyOverviewRow[] {
    return this.store.agencyOverview();
  }

  drafts(status?: VacancyDraft['status']): VacancyDraft[] {
    return this.store.listDrafts(status);
  }

  clients(): ClientRow[] {
    return this.store.listEmployers().map((employer) => {
      const vacancies = this.store.employerStats(employer.id);
      const applications = vacancies.reduce((sum, stats) => sum + stats.applications, 0);
      const newApplications = vacancies.reduce((sum, stats) => sum + stats.newApplications, 0);
      const lastSeenAt = this.store.employerLastSeen(employer.id);
      return {
        employer,
        portalUrl: this.store.getPortalUrl(employer.id),
        vacancies,
        applications,
        newApplications,
        lastSeenAt,
        needsChasing: newApplications > 0 && (lastSeenAt === null || this.isStale(lastSeenAt)),
      };
    });
  }

  private isStale(lastSeenAt: string, hours = 48): boolean {
    return Date.now() - new Date(lastSeenAt).getTime() > hours * 3_600_000;
  }

  vacanciesFor(employerId: string): Vacancy[] {
    return this.store.listVacanciesByEmployer(employerId);
  }

  /** Resend the employer's way in - a fresh one-time code or an OTP. */
  resendAccess(employerId: string, kind: AccessGrantKind = 'one_time_code', destination?: string): IssuedSecret {
    const employer = this.store.getEmployer(employerId);
    if (employer === null) throw AppError.notFound('Employer client not found.');

    let issued: IssuedSecret;
    if (kind === 'one_time_code') {
      issued = this.access.issueOneTimeCode(employerId);
    } else if (kind === 'email_otp' || kind === 'phone_otp') {
      const target = destination ?? (kind === 'email_otp' ? employer.contactEmail : employer.contactPhone);
      if (target === null || target === undefined || target.length === 0) {
        throw AppError.badRequest('missing_destination', 'Add a contact email or phone for this client first.');
      }
      issued = this.access.issueOtp(employerId, kind, target);
    } else {
      throw AppError.badRequest('unsupported_kind', 'Set a password directly instead of resending it.');
    }

    this.bus.publish('agency', AGENCY_SCOPE_ID, 'employer_access_issued', {
      employerId,
      employerName: employer.name,
      kind,
      expiresAt: issued.expiresAt,
    });
    return issued;
  }

  setEmployerPassword(employerId: string, password: string): void {
    if (this.store.getEmployer(employerId) === null) throw AppError.notFound('Employer client not found.');
    this.access.setPassword(employerId, password);
  }

  /** Applicants register through Soko Huru, so registration lives on this side. */
  registerApplicant(input: {
    fullName: string;
    phone: string;
    email?: string | null;
    location: string;
    gender?: Applicant['gender'];
    dateOfBirth?: string | null;
    educationLevel?: Applicant['educationLevel'];
    languages?: string[];
    willingToRelocate?: boolean;
    availableFrom?: string | null;
    verified?: boolean;
  }): Applicant {
    const existing = this.store.getApplicantByPhone(input.phone);
    if (existing !== null) {
      throw AppError.conflict('applicant_exists', 'An applicant with that phone number is already registered.');
    }
    return this.store.createApplicant({
      fullName: input.fullName,
      phone: input.phone,
      email: input.email ?? null,
      location: input.location,
      gender: input.gender ?? 'undisclosed',
      dateOfBirth: input.dateOfBirth ?? null,
      educationLevel: input.educationLevel ?? 'none',
      languages: input.languages ?? [],
      willingToRelocate: input.willingToRelocate ?? false,
      availableFrom: input.availableFrom ?? null,
      sokoHuruVerified: input.verified ?? true,
    });
  }

  applicants(): Applicant[] {
    return this.store.listApplicants();
  }

  /** Clients who have candidates waiting and have not looked at the page. */
  clientsNotReviewing(): ClientRow[] {
    return this.clients().filter((client) => client.needsChasing);
  }

  report(): RecruitmentReport {
    const byClient = this.clients();
    const flatVacancies = byClient.flatMap((client) => client.vacancies);
    return {
      generatedAt: new Date().toISOString(),
      totals: {
        clients: byClient.length,
        vacancies: flatVacancies.length,
        positions: flatVacancies.reduce((sum, stats) => sum + stats.positions, 0),
        applications: flatVacancies.reduce((sum, stats) => sum + stats.applications, 0),
        shortlisted: flatVacancies.reduce((sum, stats) => sum + stats.shortlisted, 0),
        interviewInvited: flatVacancies.reduce((sum, stats) => sum + stats.interviewInvited, 0),
        hired: flatVacancies.reduce((sum, stats) => sum + stats.hired, 0),
        remainingPositions: flatVacancies.reduce((sum, stats) => sum + stats.remainingPositions, 0),
      },
      byClient,
      unreviewedByClient: byClient
        .filter((client) => client.newApplications > 0)
        .map((client) => ({
          employerName: client.employer.name,
          unreviewed: client.newApplications,
          lastSeenAt: client.lastSeenAt,
        }))
        .sort((a, b) => b.unreviewed - a.unreviewed),
    };
  }

  categoryBreakdown(): { category: JobCategory; vacancies: number; applications: number }[] {
    const totals = new Map<JobCategory, { vacancies: number; applications: number }>();
    for (const employer of this.store.listEmployers()) {
      for (const vacancy of this.store.listVacanciesByEmployer(employer.id)) {
        const stats = this.store.vacancyStats(vacancy.id);
        const entry = totals.get(vacancy.category) ?? { vacancies: 0, applications: 0 };
        entry.vacancies += 1;
        entry.applications += stats?.applications ?? 0;
        totals.set(vacancy.category, entry);
      }
    }
    return [...totals.entries()]
      .map(([category, entry]) => ({ category, ...entry }))
      .sort((a, b) => b.applications - a.applications);
  }
}
