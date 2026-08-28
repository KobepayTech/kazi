import type { TenantStore } from '../data/store.ts';
import { STATUS_LABELS, STATUS_MESSAGES, flowPosition } from '../domain/applications.ts';
import { buildApplicationPackage } from '../domain/application-package.ts';
import type { ApplicationPackage } from '../domain/application-package.ts';
import { buildJobCard } from '../domain/cards.ts';
import { byNewest, eligibilityFailures, filterReasons } from '../domain/feed.ts';
import { evaluateJobFit, fitVerdictLabel } from '../domain/matching.ts';
import type { JobFit } from '../domain/matching.ts';
import { checkMembership } from '../domain/plans.ts';
import { formatSalaryLine } from '../domain/salary.ts';
import type {
  Applicant,
  Application,
  ApplicationStatus,
  Job,
  JobCard,
  MembershipPlan,
  SwipeDirection,
  Tenant,
} from '../domain/types.ts';
import { AppError } from './errors.ts';
import { AGENCY_SCOPE_ID, EventBus } from './events.ts';

export type ApplyPrompt = {
  jobId: string;
  title: string;
  employerName: string;
  /** "Your CV will be shared with this employer." */
  message: string;
};

export type ApplicationConfirmation = {
  message: string;
  position: string;
  company: string;
  submittedThrough: string;
  applicationNumber: string;
  status: string;
};

export type SwipeOutcome =
  | { result: 'confirm_required'; prompt: ApplyPrompt }
  | { result: 'applied'; application: Application; confirmation: ApplicationConfirmation; applicationPackage: ApplicationPackage }
  | { result: 'skipped'; jobId: string }
  | { result: 'saved'; jobId: string }
  | { result: 'blocked'; code: string; message: string; upgradeTo?: MembershipPlan | null; reference?: string };

export type TrackedApplication = {
  reference: string;
  jobId: string;
  jobTitle: string;
  employerName: string;
  status: ApplicationStatus;
  statusLabel: string;
  statusMessage: string;
  step: number;
  appliedAt: string;
  updatedAt: string;
};

export type JobDetail = {
  job: Job;
  employerName: string;
  salaryLine: string;
  remainingPositions: number;
  postedThrough: string;
  alreadyApplied: boolean;
  saved: boolean;
  /** Candidate-specific match explanation when an applicant is signed in. */
  fit: JobFit | null;
};

export class SwipeService {
  private readonly store: TenantStore;
  private readonly tenant: Tenant;
  private readonly bus: EventBus;

  constructor(store: TenantStore, tenant: Tenant, bus: EventBus) {
    this.store = store;
    this.tenant = tenant;
    this.bus = bus;
  }

  private requireApplicant(applicantId: string): Applicant {
    const applicant = this.store.getApplicant(applicantId);
    if (applicant === null) throw AppError.notFound('Applicant not found.');
    return applicant;
  }

  private employerName(employerId: string): string {
    return this.store.getEmployer(employerId)?.name ?? 'Employer';
  }

  /**
   * The deck: open jobs that pass the applicant's filters, ranked by Kobe Fit.
   * Newest publication time breaks ties so fresh vacancies still surface first.
   */
  feed(applicantId: string, limit = 20): JobCard[] {
    const applicant = this.requireApplicant(applicantId);
    const preferences = this.store.getPreferences(applicantId);
    const resolved = this.store.listResolvedJobIds(applicantId);
    const hiredCounts = this.store.hiredCountsByJob();

    return this.store
      .listPublishedJobs()
      .filter((job) => !resolved.has(job.id))
      .filter((job) => eligibilityFailures(job, { hiredCount: hiredCounts.get(job.id) ?? 0 }).length === 0)
      .filter((job) => filterReasons(job, preferences).length === 0)
      .map((job) => ({ job, fit: evaluateJobFit(applicant, job, preferences) }))
      .sort((left, right) => right.fit.score - left.fit.score || byNewest(left.job, right.job))
      .slice(0, limit)
      .map(({ job, fit }) => {
        const card = buildJobCard(job, {
          employerName: this.employerName(job.employerId),
          agencyName: this.tenant.name,
          remainingPositions: Math.max(0, job.positions - (hiredCounts.get(job.id) ?? 0)),
        });
        return {
          ...card,
          highlights: [`Kobe Fit: ${fit.score}% · ${fitVerdictLabel(fit.verdict)}`, ...card.highlights],
        };
      });
  }

  savedJobs(applicantId: string): JobCard[] {
    const applicant = this.requireApplicant(applicantId);
    const preferences = this.store.getPreferences(applicantId);
    const hiredCounts = this.store.hiredCountsByJob();
    const cards: JobCard[] = [];
    for (const jobId of this.store.listSavedJobIds(applicantId)) {
      const job = this.store.getJob(jobId);
      if (job === null) continue;
      const fit = evaluateJobFit(applicant, job, preferences);
      const card = buildJobCard(job, {
        employerName: this.employerName(job.employerId),
        agencyName: this.tenant.name,
        remainingPositions: Math.max(0, job.positions - (hiredCounts.get(job.id) ?? 0)),
        saved: true,
      });
      cards.push({
        ...card,
        highlights: [`Kobe Fit: ${fit.score}% · ${fitVerdictLabel(fit.verdict)}`, ...card.highlights],
      });
    }
    return cards;
  }

  /** Tapping a card opens the full advert, including the original poster. */
  jobDetail(jobId: string, applicantId: string | null = null): JobDetail {
    const job = this.store.getJob(jobId);
    if (job === null || job.status === 'draft') throw AppError.notFound('Job not found.');
    const applicant = applicantId === null ? null : this.store.getApplicant(applicantId);
    const preferences = applicant === null ? null : this.store.getPreferences(applicant.id);
    return {
      job,
      employerName: this.employerName(job.employerId),
      salaryLine: formatSalaryLine(job.salary),
      remainingPositions: Math.max(0, job.positions - this.store.countHired(job.id)),
      postedThrough: this.tenant.name,
      alreadyApplied: applicantId !== null && this.store.findApplication(job.id, applicantId) !== null,
      saved: applicantId !== null && this.store.listSavedJobIds(applicantId).includes(job.id),
      fit: applicant === null ? null : evaluateJobFit(applicant, job, preferences),
    };
  }

  /**
   * A right swipe never submits on its own: the first call returns the prompt
   * the app shows, and only a confirmed call creates the application. An
   * accidental swipe must not send someone's CV to an employer.
   */
  swipe(applicantId: string, jobId: string, direction: SwipeDirection, confirmed = false): SwipeOutcome {
    const applicant = this.requireApplicant(applicantId);
    const job = this.store.getJob(jobId);
    if (job === null) throw AppError.notFound('Job not found.');

    if (direction === 'left') {
      this.store.recordSwipe(applicantId, jobId, 'left');
      return { result: 'skipped', jobId };
    }
    if (direction === 'up') {
      this.store.recordSwipe(applicantId, jobId, 'up');
      return { result: 'saved', jobId };
    }

    if (!confirmed) {
      return {
        result: 'confirm_required',
        prompt: {
          jobId: job.id,
          title: job.title,
          employerName: this.employerName(job.employerId),
          message: 'Your CV will be shared with this employer.',
        },
      };
    }
    return this.apply(applicant, job);
  }

  /**
   * Right swipe confirmed:
   *   membership check -> CV attached -> application created ->
   *   employer page updated -> agency dashboard updated -> applicant told.
   */
  private apply(applicant: Applicant, job: Job): SwipeOutcome {
    const existing = this.store.findApplication(job.id, applicant.id);
    if (existing !== null) {
      return {
        result: 'blocked',
        code: 'already_applied',
        message: 'You have already applied for this job.',
        reference: existing.reference,
      };
    }

    const membership = this.store.getActiveMembership(applicant.id) ?? this.store.getLatestMembership(applicant.id);
    const plan = membership === null ? null : this.store.getPlan(membership.planCode);
    const check = checkMembership(membership, plan, job, this.store.listPlans());
    if (!check.ok) {
      return { result: 'blocked', code: check.code, message: check.message, upgradeTo: check.upgradeTo };
    }

    const failures = eligibilityFailures(job, { hiredCount: this.store.countHired(job.id) });
    const firstFailure = failures[0];
    if (firstFailure !== undefined) {
      return { result: 'blocked', code: firstFailure.code, message: firstFailure.message };
    }

    const cv = this.store.getCvByApplicant(applicant.id);
    if (cv === null) {
      return { result: 'blocked', code: 'no_cv', message: 'Finish your profile so KobeOS can build your CV.' };
    }

    const application = this.store.transaction(() => {
      const created = this.store.createApplication({
        reference: this.store.nextApplicationReference(),
        jobId: job.id,
        applicantId: applicant.id,
        cvId: cv.id,
        employerId: job.employerId,
      });
      this.store.recordSwipe(applicant.id, job.id, 'right');
      return created;
    });

    const employerName = this.employerName(job.employerId);
    const payload = {
      applicationId: application.id,
      reference: application.reference,
      jobId: job.id,
      jobTitle: job.title,
      employerId: job.employerId,
      applicantId: applicant.id,
      applicantName: applicant.fullName,
      status: application.status,
    };
    this.bus.publish('employer', job.employerId, 'application_received', payload);
    this.bus.publish('agency', AGENCY_SCOPE_ID, 'application_received', payload);
    this.bus.publish('applicant', applicant.id, 'application_submitted', payload);

    const applicationPackage = buildApplicationPackage({
      applicant,
      cv,
      job,
      employerName,
      preferences: this.store.getPreferences(applicant.id),
    });

    return {
      result: 'applied',
      application,
      applicationPackage,
      confirmation: {
        message: 'Application submitted successfully',
        position: job.title,
        company: employerName,
        submittedThrough: this.tenant.name,
        applicationNumber: application.reference,
        status: 'Applied',
      },
    };
  }

  /** The applicant's own status list. */
  tracker(applicantId: string): TrackedApplication[] {
    this.requireApplicant(applicantId);
    return this.store.listApplicationsForApplicant(applicantId).map((application) => {
      const job = this.store.getJob(application.jobId);
      return {
        reference: application.reference,
        jobId: application.jobId,
        jobTitle: job?.title ?? 'Job',
        employerName: this.employerName(application.employerId),
        status: application.status,
        statusLabel: STATUS_LABELS[application.status],
        statusMessage: STATUS_MESSAGES[application.status],
        step: flowPosition(application.status),
        appliedAt: application.createdAt,
        updatedAt: application.updatedAt,
      };
    });
  }

  /** Rebuild the job-specific CV, cover letter and interview prep for an application. */
  applicationPackage(applicantId: string, applicationId: string): ApplicationPackage {
    const applicant = this.requireApplicant(applicantId);
    const application = this.store.getApplication(applicationId);
    if (application === null || application.applicantId !== applicant.id) {
      throw AppError.notFound('Application not found.');
    }
    const job = this.store.getJob(application.jobId);
    const cv = this.store.getCv(application.cvId);
    if (job === null || cv === null) throw AppError.notFound('Application package is not available.');
    return buildApplicationPackage({
      applicant,
      cv,
      job,
      employerName: this.employerName(application.employerId),
      preferences: this.store.getPreferences(applicant.id),
    });
  }
}
