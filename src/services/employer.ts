import type { ApplicationDetail, ApplicationFilters, DraftStatus, TenantStore } from '../data/store.ts';
import { STATUS_LABELS, STATUS_MESSAGES, assertTransition } from '../domain/applications.ts';
import { renderCvText } from '../domain/cv.ts';
import { relocationNote } from '../domain/feed.ts';
import type {
  Actor,
  Application,
  ApplicationStatus,
  ApplicationStatusChange,
  Employer,
  Job,
  JobStats,
} from '../domain/types.ts';
import { AppError } from './errors.ts';
import { AGENCY_SCOPE_ID, EventBus } from './events.ts';

export type EmployerDashboard = {
  employer: Employer;
  jobs: JobStats[];
  totals: {
    positions: number;
    applications: number;
    newApplications: number;
    viewed: number;
    shortlisted: number;
    interview: number;
    hired: number;
    remainingPositions: number;
  };
};

/** A vacancy the client typed into their own page, and where it has got to. */
export type EmployerSubmissionRow = {
  draftId: string;
  title: string;
  positions: number;
  status: DraftStatus;
  jobId: string | null;
  submittedAt: string;
};

export type CandidateCard = ApplicationDetail & {
  statusLabel: string;
  /** "Ready to relocate", shown under the candidate's location. */
  relocation: string | null;
};

export type CandidateDossier = CandidateCard & {
  history: ApplicationStatusChange[];
  cvText: string;
};

/**
 * The employer's private page. Every method takes the employer id the caller
 * is signed in as and checks it, so one client can never reach another's
 * candidates even with a guessed id.
 */
export class EmployerService {
  private readonly store: TenantStore;
  private readonly bus: EventBus;

  constructor(store: TenantStore, bus: EventBus) {
    this.store = store;
    this.bus = bus;
  }

  dashboard(employerId: string): EmployerDashboard {
    const employer = this.store.getEmployer(employerId);
    if (employer === null) throw AppError.notFound('Employer not found.');
    const jobs = this.store.employerStats(employerId);
    const totals = jobs.reduce(
      (sum, stats) => ({
        positions: sum.positions + stats.positions,
        applications: sum.applications + stats.applications,
        newApplications: sum.newApplications + stats.newApplications,
        viewed: sum.viewed + stats.viewed,
        shortlisted: sum.shortlisted + stats.shortlisted,
        interview: sum.interview + stats.interview,
        hired: sum.hired + stats.hired,
        remainingPositions: sum.remainingPositions + stats.remainingPositions,
      }),
      { positions: 0, applications: 0, newApplications: 0, viewed: 0, shortlisted: 0, interview: 0, hired: 0, remainingPositions: 0 },
    );
    return { employer, jobs, totals };
  }

  /** What the client has sent in, and whether the agency has published it yet. */
  submissions(employerId: string): EmployerSubmissionRow[] {
    return this.store
      .listDraftsForEmployer(employerId)
      .filter((draft) => draft.intakeChannel === 'employer_form')
      .map((draft) => ({
        draftId: draft.id,
        title: draft.extraction.job.title ?? 'Untitled vacancy',
        positions: draft.extraction.job.positions ?? 1,
        status: draft.status,
        jobId: draft.jobId,
        submittedAt: draft.createdAt,
      }));
  }

  job(employerId: string, jobId: string): Job {
    const job = this.store.getJob(jobId);
    if (job === null || job.employerId !== employerId) throw AppError.notFound('Job not found.');
    return job;
  }

  candidates(employerId: string, filters: ApplicationFilters = {}): CandidateCard[] {
    return this.store.listApplicationsForEmployer(employerId, filters).map((detail) => this.decorate(detail));
  }

  private decorate(detail: ApplicationDetail): CandidateCard {
    const job = this.store.getJob(detail.application.jobId);
    return {
      ...detail,
      statusLabel: STATUS_LABELS[detail.application.status],
      relocation: job === null ? null : relocationNote(detail.applicant, job),
    };
  }

  private requireApplication(employerId: string, applicationId: string): Application {
    const application = this.store.getApplication(applicationId);
    if (application === null || application.employerId !== employerId) {
      throw AppError.notFound('Application not found.');
    }
    return application;
  }

  /** Opening a CV marks the candidate Viewed, which is what moves the tile. */
  openCandidate(employerId: string, applicationId: string, actor: Actor): CandidateDossier {
    const application = this.requireApplication(employerId, applicationId);
    if (application.status === 'applied') {
      this.transition(employerId, applicationId, 'viewed', actor, null);
    }
    const [detail] = this.store.listApplicationsForEmployer(employerId, { applicationId, limit: 1 });
    if (detail === undefined) throw AppError.notFound('Application not found.');
    return {
      ...this.decorate(detail),
      history: this.store.listStatusHistory(applicationId),
      cvText: renderCvText(detail.cv),
    };
  }

  /**
   * Moves a candidate along the flow. The rules live in the domain, so the
   * employer page and the agency console enforce exactly the same steps.
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
      this.store.addStatusChange(applicationId, application.status, to, actor, note);
      const next = this.store.getApplication(applicationId);
      if (next === null) throw AppError.notFound('Application not found.');

      // Filling the last position closes the job for everybody.
      if (to === 'hired') {
        const job = this.store.getJob(next.jobId);
        if (job !== null && this.store.countHired(job.id) >= job.positions) {
          this.store.setJobStatus(job.id, 'filled');
        }
      }
      return next;
    });

    const payload = {
      applicationId,
      reference: updated.reference,
      jobId: updated.jobId,
      employerId,
      applicantId: updated.applicantId,
      fromStatus: application.status,
      status: to,
      statusLabel: STATUS_LABELS[to],
      message: STATUS_MESSAGES[to],
      by: actor.kind,
      note,
    };
    this.bus.publish('employer', employerId, 'application_status_changed', payload);
    this.bus.publish('agency', AGENCY_SCOPE_ID, 'application_status_changed', payload);
    // This is what makes the applicant's phone update the moment Shortlist is pressed.
    this.bus.publish('applicant', updated.applicantId, 'application_status_changed', payload);
    return updated;
  }

  shortlist(employerId: string, applicationId: string, actor: Actor, note: string | null = null): Application {
    return this.transition(employerId, applicationId, 'shortlisted', actor, note);
  }

  inviteToInterview(employerId: string, applicationId: string, actor: Actor, note: string | null = null): Application {
    return this.transition(employerId, applicationId, 'interview', actor, note);
  }

  reject(employerId: string, applicationId: string, actor: Actor, note: string | null = null): Application {
    return this.transition(employerId, applicationId, 'rejected', actor, note);
  }

  markHired(employerId: string, applicationId: string, actor: Actor, note: string | null = null): Application {
    return this.transition(employerId, applicationId, 'hired', actor, note);
  }

  addNote(employerId: string, applicationId: string, note: string): Application {
    this.requireApplication(employerId, applicationId);
    this.store.setApplicationNotes(applicationId, note);
    const updated = this.store.getApplication(applicationId);
    if (updated === null) throw AppError.notFound('Application not found.');
    return updated;
  }

  closeJob(employerId: string, jobId: string, actor: Actor): Job {
    const job = this.job(employerId, jobId);
    this.store.setJobStatus(jobId, 'closed');
    const payload = { jobId, employerId, title: job.title, by: actor.kind };
    this.bus.publish('employer', employerId, 'job_closed', payload);
    this.bus.publish('agency', AGENCY_SCOPE_ID, 'job_closed', payload);
    const updated = this.store.getJob(jobId);
    if (updated === null) throw AppError.notFound('Job not found.');
    return updated;
  }
}
