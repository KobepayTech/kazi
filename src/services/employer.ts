import type { ApplicationDetail, EmployerApplicationFilters, Store } from '../data/store.ts';
import { STATUS_LABELS, assertTransition } from '../domain/applications.ts';
import type {
  Actor,
  Application,
  ApplicationEvent,
  ApplicationStatus,
  Employer,
  Vacancy,
  VacancyStats,
} from '../domain/types.ts';
import { AppError } from './errors.ts';
import { AGENCY_SCOPE_ID, EventBus } from './events.ts';

export type EmployerDashboard = {
  employer: Employer;
  portalUrl: string | null;
  vacancies: VacancyStats[];
  totals: {
    positions: number;
    applications: number;
    newApplications: number;
    shortlisted: number;
    interviewInvited: number;
    hired: number;
    remainingPositions: number;
  };
};

export type ApplicationSummary = ApplicationDetail & { statusLabel: string };

export type ApplicationDossier = ApplicationSummary & { history: ApplicationEvent[] };

/**
 * Everything the automatically generated employer recruitment page can do.
 * Every method takes the employer id the caller is authenticated as, and every
 * lookup is checked against it, so one client can never reach another's
 * applicants even with a guessed id.
 */
export class EmployerService {
  private readonly store: Store;
  private readonly bus: EventBus;

  constructor(store: Store, bus: EventBus) {
    this.store = store;
    this.bus = bus;
  }

  dashboard(employerId: string): EmployerDashboard {
    const employer = this.store.getEmployer(employerId);
    if (employer === null) throw AppError.notFound('Employer not found.');
    const vacancies = this.store.employerStats(employerId);
    const totals = vacancies.reduce(
      (sum, stats) => ({
        positions: sum.positions + stats.positions,
        applications: sum.applications + stats.applications,
        newApplications: sum.newApplications + stats.newApplications,
        shortlisted: sum.shortlisted + stats.shortlisted,
        interviewInvited: sum.interviewInvited + stats.interviewInvited,
        hired: sum.hired + stats.hired,
        remainingPositions: sum.remainingPositions + stats.remainingPositions,
      }),
      { positions: 0, applications: 0, newApplications: 0, shortlisted: 0, interviewInvited: 0, hired: 0, remainingPositions: 0 },
    );
    return { employer, portalUrl: this.store.getPortalUrl(employerId), vacancies, totals };
  }

  vacancy(employerId: string, vacancyId: string): Vacancy {
    const vacancy = this.store.getVacancy(vacancyId);
    if (vacancy === null || vacancy.employerId !== employerId) throw AppError.notFound('Vacancy not found.');
    return vacancy;
  }

  applications(employerId: string, filters: EmployerApplicationFilters = {}): ApplicationSummary[] {
    return this.store.listApplicationsForEmployer(employerId, filters).map((detail) => ({
      ...detail,
      statusLabel: STATUS_LABELS[detail.application.status],
    }));
  }

  private requireApplication(employerId: string, applicationId: string): Application {
    const application = this.store.getApplication(applicationId);
    if (application === null || application.employerId !== employerId) {
      throw AppError.notFound('Application not found.');
    }
    return application;
  }

  /** Opening a candidate marks them Viewed, which is what moves the tile. */
  openApplication(employerId: string, applicationId: string, actor: Actor): ApplicationDossier {
    const application = this.requireApplication(employerId, applicationId);
    if (application.status === 'applied') {
      this.transition(employerId, applicationId, 'viewed', actor, null);
    }
    const detail = this.findDetail(employerId, applicationId);
    return {
      ...detail,
      statusLabel: STATUS_LABELS[detail.application.status],
      history: this.store.listApplicationEvents(applicationId),
    };
  }

  private findDetail(employerId: string, applicationId: string): ApplicationDetail {
    const [detail] = this.store.listApplicationsForEmployer(employerId, { applicationId, limit: 1 });
    if (detail === undefined) throw AppError.notFound('Application not found.');
    return detail;
  }

  /**
   * Moves an application along the status flow. The transition rules live in
   * the domain, so the employer page, the agency console and the API all
   * enforce exactly the same flow.
   */
  transition(
    employerId: string,
    applicationId: string,
    to: ApplicationStatus,
    actor: Actor,
    note: string | null,
  ): Application {
    const application = this.requireApplication(employerId, applicationId);
    assertTransition(application.status, to, actor.kind);

    const updated = this.store.transaction(() => {
      this.store.updateApplicationStatus(applicationId, to);
      this.store.addApplicationEvent(applicationId, application.status, to, actor, note);
      const next = this.store.getApplication(applicationId);
      if (next === null) throw AppError.notFound('Application not found.');

      // Closing the last position closes the vacancy for everybody.
      if (to === 'hired') {
        const vacancy = this.store.getVacancy(next.vacancyId);
        if (vacancy !== null && this.store.countHired(vacancy.id) >= vacancy.positions) {
          this.store.setVacancyStatus(vacancy.id, 'filled');
        }
      }
      return next;
    });

    const payload = {
      applicationId,
      reference: updated.reference,
      vacancyId: updated.vacancyId,
      employerId,
      applicantId: updated.applicantId,
      fromStatus: application.status,
      status: to,
      statusLabel: STATUS_LABELS[to],
      by: actor.kind,
      note,
    };
    this.bus.publish('employer', employerId, 'application_status_changed', payload);
    this.bus.publish('agency', AGENCY_SCOPE_ID, 'application_status_changed', payload);
    this.bus.publish('applicant', updated.applicantId, 'application_status_changed', payload);
    return updated;
  }

  shortlist(employerId: string, applicationId: string, actor: Actor, note: string | null = null): Application {
    return this.transition(employerId, applicationId, 'shortlisted', actor, note);
  }

  reject(employerId: string, applicationId: string, actor: Actor, note: string | null = null): Application {
    return this.transition(employerId, applicationId, 'rejected', actor, note);
  }

  markHired(employerId: string, applicationId: string, actor: Actor, note: string | null = null): Application {
    return this.transition(employerId, applicationId, 'hired', actor, note);
  }

  inviteToInterview(
    employerId: string,
    applicationId: string,
    interviewAt: string | null,
    actor: Actor,
    note: string | null = null,
  ): Application {
    const application = this.transition(employerId, applicationId, 'interview_invited', actor, note);
    if (interviewAt !== null) {
      this.store.setInterviewAt(applicationId, interviewAt);
      this.bus.publish('applicant', application.applicantId, 'interview_scheduled', {
        applicationId,
        reference: application.reference,
        interviewAt,
      });
    }
    return this.store.getApplication(applicationId) ?? application;
  }

  addNote(employerId: string, applicationId: string, note: string): Application {
    this.requireApplication(employerId, applicationId);
    this.store.setApplicationNotes(applicationId, note);
    const updated = this.store.getApplication(applicationId);
    if (updated === null) throw AppError.notFound('Application not found.');
    return updated;
  }

  closeVacancy(employerId: string, vacancyId: string, actor: Actor): Vacancy {
    const vacancy = this.vacancy(employerId, vacancyId);
    this.store.setVacancyStatus(vacancyId, 'closed');
    const payload = { vacancyId, employerId, title: vacancy.title, by: actor.kind };
    this.bus.publish('employer', employerId, 'vacancy_closed', payload);
    this.bus.publish('agency', AGENCY_SCOPE_ID, 'vacancy_closed', payload);
    const updated = this.store.getVacancy(vacancyId);
    if (updated === null) throw AppError.notFound('Vacancy not found.');
    return updated;
  }

  /** "Request more candidates" lands on the Soko Huru dashboard as a task. */
  requestMoreCandidates(employerId: string, vacancyId: string, message: string | null): void {
    const vacancy = this.vacancy(employerId, vacancyId);
    const employer = this.store.getEmployer(employerId);
    this.bus.publish('agency', AGENCY_SCOPE_ID, 'more_candidates_requested', {
      employerId,
      employerName: employer?.name ?? employerId,
      vacancyId,
      vacancyTitle: vacancy.title,
      message,
    });
  }
}
