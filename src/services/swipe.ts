import { AGENCY_NAME } from '../config.ts';
import type { Store } from '../data/store.ts';
import { STATUS_LABELS, flowPosition } from '../domain/applications.ts';
import { buildJobCard } from '../domain/cards.ts';
import { checkMembership } from '../domain/membership.ts';
import {
  eligibilityFailures,
  preferenceMismatches,
  scoreMatch,
  selectBestCv,
} from '../domain/matching.ts';
import type {
  Applicant,
  Application,
  Cv,
  JobCard,
  MembershipPackage,
  SwipeDirection,
  Vacancy,
} from '../domain/types.ts';
import { AppError } from './errors.ts';
import { AGENCY_SCOPE_ID, EventBus } from './events.ts';

export type ApplicationConfirmation = {
  message: string;
  position: string;
  company: string;
  submittedThrough: string;
  cvUsed: string;
  applicationNumber: string;
  status: string;
};

export type SwipeOutcome =
  | { result: 'applied'; application: Application; confirmation: ApplicationConfirmation }
  | { result: 'skipped'; vacancyId: string }
  | { result: 'saved'; vacancyId: string }
  | {
      result: 'blocked';
      code: string;
      message: string;
      upgradeTo?: MembershipPackage | null;
      reference?: string;
    };

export type TrackedApplication = {
  reference: string;
  vacancyTitle: string;
  employerName: string;
  status: Application['status'];
  statusLabel: string;
  step: number;
  matchScore: number;
  interviewAt: string | null;
  appliedAt: string;
  updatedAt: string;
};

/**
 * An applicant with no CV on file can still browse. Scoring falls back to what
 * their profile says so the deck is not empty, but applying needs a real CV.
 */
function profileCv(applicant: Applicant): Cv {
  return {
    id: 'profile',
    applicantId: applicant.id,
    label: 'Profile',
    categories: [],
    headline: null,
    experienceYears: 0,
    educationLevel: applicant.educationLevel,
    skills: [],
    languages: applicant.languages,
    certificates: [],
    preferredSalaryTzs: null,
    filePath: null,
    isDefault: true,
    createdAt: applicant.createdAt,
  };
}

export class SwipeService {
  private readonly store: Store;
  private readonly bus: EventBus;

  constructor(store: Store, bus: EventBus) {
    this.store = store;
    this.bus = bus;
  }

  private requireApplicant(applicantId: string): Applicant {
    const applicant = this.store.getApplicant(applicantId);
    if (applicant === null) throw AppError.notFound('Applicant not found.');
    return applicant;
  }

  /**
   * The deck. Only cards the applicant asked for in their filters, only
   * vacancies they are actually eligible for, best match first.
   */
  feed(applicantId: string, limit = 20): JobCard[] {
    const applicant = this.requireApplicant(applicantId);
    const preferences = this.store.getPreferences(applicantId);
    const cvs = this.store.listCvs(applicantId);
    const resolved = this.store.listResolvedVacancyIds(applicantId);
    const hiredCounts = this.store.hiredCountsByVacancy();

    const cards: { card: JobCard; publishedAt: string }[] = [];
    for (const vacancy of this.store.listPublishedVacancies()) {
      if (resolved.has(vacancy.id)) continue;
      const hiredCount = hiredCounts.get(vacancy.id) ?? 0;
      if (eligibilityFailures(vacancy, applicant, { hiredCount }).length > 0) continue;
      if (preferenceMismatches(vacancy, preferences, applicant).length > 0) continue;

      const best =
        selectBestCv(vacancy, applicant, cvs, preferences) ??
        { cv: profileCv(applicant), match: scoreMatch(vacancy, applicant, profileCv(applicant), preferences) };

      cards.push({
        card: buildJobCard(vacancy, best.match, {
          remainingPositions: Math.max(0, vacancy.positions - hiredCount),
        }),
        publishedAt: vacancy.publishedAt ?? vacancy.createdAt,
      });
    }

    return cards
      .sort((a, b) => b.card.matchScore - a.card.matchScore || b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, limit)
      .map((entry) => entry.card);
  }

  savedJobs(applicantId: string): JobCard[] {
    const applicant = this.requireApplicant(applicantId);
    const preferences = this.store.getPreferences(applicantId);
    const cvs = this.store.listCvs(applicantId);
    const hiredCounts = this.store.hiredCountsByVacancy();

    const cards: JobCard[] = [];
    for (const vacancyId of this.store.listSavedVacancyIds(applicantId)) {
      const vacancy = this.store.getVacancy(vacancyId);
      if (vacancy === null) continue;
      const best =
        selectBestCv(vacancy, applicant, cvs, preferences) ??
        { cv: profileCv(applicant), match: scoreMatch(vacancy, applicant, profileCv(applicant), preferences) };
      cards.push(
        buildJobCard(vacancy, best.match, {
          remainingPositions: Math.max(0, vacancy.positions - (hiredCounts.get(vacancy.id) ?? 0)),
        }),
      );
    }
    return cards;
  }

  swipe(applicantId: string, vacancyId: string, direction: SwipeDirection): SwipeOutcome {
    const applicant = this.requireApplicant(applicantId);
    const vacancy = this.store.getVacancy(vacancyId);
    if (vacancy === null) throw AppError.notFound('Vacancy not found.');

    if (direction === 'left') {
      this.store.recordSwipe(applicantId, vacancyId, 'left');
      return { result: 'skipped', vacancyId };
    }
    if (direction === 'up') {
      this.store.recordSwipe(applicantId, vacancyId, 'up');
      return { result: 'saved', vacancyId };
    }
    return this.apply(applicant, vacancy);
  }

  /**
   * What happens after a right swipe, in the order the workflow specifies:
   *
   *   1. active Soko Huru membership?
   *   2. does the package cover this vacancy category?
   *   3. pick the most relevant CV
   *   4. create the application
   *   5. push it to the employer's private page
   *   6. update the Soko Huru dashboard
   *   7. confirm to the applicant
   */
  private apply(applicant: Applicant, vacancy: Vacancy): SwipeOutcome {
    const existing = this.store.findApplication(vacancy.id, applicant.id);
    if (existing !== null) {
      return {
        result: 'blocked',
        code: 'already_applied',
        message: 'You have already applied for this vacancy.',
        reference: existing.reference,
      };
    }

    const packages = this.store.listPackages();
    const membership = this.store.getActiveMembership(applicant.id) ?? this.store.getLatestMembership(applicant.id);
    const pkg = membership === null ? null : this.store.getPackage(membership.packageCode);
    const check = checkMembership(membership, pkg, vacancy, packages);
    if (!check.ok) {
      return { result: 'blocked', code: check.code, message: check.message, upgradeTo: check.upgradeTo };
    }

    const hiredCount = this.store.countHired(vacancy.id);
    const failures = eligibilityFailures(vacancy, applicant, { hiredCount });
    if (failures.length > 0) {
      const first = failures[0];
      if (first !== undefined) return { result: 'blocked', code: first.code, message: first.message };
    }

    const preferences = this.store.getPreferences(applicant.id);
    const best = selectBestCv(vacancy, applicant, this.store.listCvs(applicant.id), preferences);
    if (best === null) {
      return {
        result: 'blocked',
        code: 'no_cv',
        message: 'Create a CV in your Soko Huru profile before applying.',
      };
    }

    const employer = this.store.getEmployer(vacancy.employerId);
    const employerName = employer?.name ?? 'the employer';

    const application = this.store.transaction(() => {
      const reference = this.store.nextApplicationReference();
      const created = this.store.createApplication({
        reference,
        vacancyId: vacancy.id,
        applicantId: applicant.id,
        cvId: best.cv.id,
        employerId: vacancy.employerId,
        matchScore: best.match.score,
      });
      this.store.incrementApplicationsUsed(check.membership.id);
      this.store.recordSwipe(applicant.id, vacancy.id, 'right');
      return created;
    });

    const payload = {
      applicationId: application.id,
      reference: application.reference,
      vacancyId: vacancy.id,
      vacancyTitle: vacancy.title,
      employerId: vacancy.employerId,
      applicantId: applicant.id,
      applicantName: applicant.fullName,
      matchScore: application.matchScore,
      status: application.status,
    };
    // 5 and 6: the employer page and the agency dashboard both update live.
    this.bus.publish('employer', vacancy.employerId, 'application_received', payload);
    this.bus.publish('agency', AGENCY_SCOPE_ID, 'application_received', payload);
    this.bus.publish('applicant', applicant.id, 'application_submitted', payload);

    return {
      result: 'applied',
      application,
      confirmation: {
        message: 'Application submitted successfully',
        position: vacancy.title,
        company: employerName,
        submittedThrough: AGENCY_NAME,
        cvUsed: best.cv.label,
        applicationNumber: application.reference,
        status: 'Received',
      },
    };
  }

  /** The applicant's own status tracker. */
  tracker(applicantId: string): TrackedApplication[] {
    this.requireApplicant(applicantId);
    return this.store.listApplicationsForApplicant(applicantId).map((application) => {
      const vacancy = this.store.getVacancy(application.vacancyId);
      const employer = this.store.getEmployer(application.employerId);
      return {
        reference: application.reference,
        vacancyTitle: vacancy?.title ?? 'Vacancy',
        employerName: employer?.name ?? 'Employer',
        status: application.status,
        statusLabel: STATUS_LABELS[application.status],
        step: flowPosition(application.status),
        matchScore: application.matchScore,
        interviewAt: application.interviewAt,
        appliedAt: application.createdAt,
        updatedAt: application.updatedAt,
      };
    });
  }
}
