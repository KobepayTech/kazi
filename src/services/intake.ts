import type { AppConfig } from '../config.ts';
import type { JobDraft, TenantStore } from '../data/store.ts';
import { RuleBasedExtractor } from '../domain/extraction.ts';
import { newId, randomShortCode } from '../domain/ids.ts';
import { formatSalaryLine, withMonthlyTzs } from '../domain/salary.ts';
import type {
  Currency,
  ExtractedJob,
  IntakeChannel,
  Job,
  JobCategory,
  JobExtractor,
  Salary,
  SalaryPeriod,
  Tenant,
} from '../domain/types.ts';
import type { Store } from '../data/store.ts';
import type { AccessService, IssuedSecret } from './access.ts';
import { AppError } from './errors.ts';
import { AGENCY_SCOPE_ID, EventBus } from './events.ts';

export type UploadInput = {
  channel: IntakeChannel;
  /** Poster text, WhatsApp message or typed entry. */
  text: string;
  /** Stored path of the poster image, shown beside the fields on review. */
  imagePath?: string | null;
  employerId?: string | null;
  employerName?: string | null;
  staffId: string;
};

export type PublishOptions = {
  staffId: string;
  employerId?: string | null;
  employerName?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
};

export type PublishResult = {
  job: Job;
  employerId: string;
  employerName: string;
  /** The private link the employer is sent, e.g. https://jobs.kobeos.app/e/7HK29D. */
  employerLink: string;
  accessCode: IssuedSecret | null;
};

const REQUIRED = ['title', 'location', 'category', 'positions', 'salary'] as const;

/** Stops a client filling the review queue with half-finished postings. */
const MAX_PENDING_EMPLOYER_DRAFTS = 20;

/** What an employer client types into their own page. */
export type EmployerSubmission = {
  employerId: string;
  title: string;
  location: string;
  category: JobCategory;
  positions: number;
  salaryAmountMin: number | null;
  salaryAmountMax: number | null;
  salaryCurrency: Currency;
  salaryPeriod: SalaryPeriod;
  salaryPlusTips: boolean;
  description: string | null;
  responsibilities: string[];
  requirements: string[];
  applicationDeadline: string | null;
  accommodationProvided: boolean;
  languages: string[];
  experienceNote: string | null;
  certificateRequired: boolean;
  immediateStart: boolean;
};

/** Renders a typed submission for the left-hand pane of the review screen. */
function renderSubmission(input: EmployerSubmission, employerName: string, salary: Salary): string {
  const lines = [
    employerName,
    `Job title: ${input.title}`,
    `Location: ${input.location}`,
    `Positions: ${input.positions}`,
    `Salary: ${formatSalaryLine(salary)}`,
  ];
  if (input.languages.length > 0) lines.push(`Languages: ${input.languages.join(', ')}`);
  if (input.experienceNote !== null) lines.push(`Experience: ${input.experienceNote}`);
  if (input.accommodationProvided) lines.push('Accommodation provided');
  if (input.certificateRequired) lines.push('Certificate required');
  if (input.immediateStart) lines.push('Immediate start');
  if (input.applicationDeadline !== null) lines.push(`Deadline: ${input.applicationDeadline}`);
  if (input.description !== null) lines.push('', input.description);
  if (input.responsibilities.length > 0) lines.push('', 'Responsibilities:', ...input.responsibilities);
  if (input.requirements.length > 0) lines.push('', 'Requirements:', ...input.requirements);
  return lines.join('\n');
}

function mergeOverrides(extracted: ExtractedJob, overrides: Record<string, unknown> | null): ExtractedJob {
  if (overrides === null) return extracted;
  const merged: ExtractedJob = { ...extracted };
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in merged) || value === undefined) continue;
    (merged as Record<string, unknown>)[key] = value;
  }
  if (merged.salary !== null) {
    // A corrected salary may arrive without its normalised monthly figure.
    merged.salary = withMonthlyTzs(merged.salary as Salary);
  }
  return merged;
}

/**
 * The agency's half of the loop: upload the post it already made, check what
 * Kobe AI read, publish. Publishing creates the swipe card and, for a new
 * client, the employer record and its private link.
 */
export class IntakeService {
  private readonly platform: Store;
  private readonly store: TenantStore;
  private readonly tenant: Tenant;
  private readonly bus: EventBus;
  private readonly access: AccessService;
  private readonly config: AppConfig;
  private readonly extractor: JobExtractor;

  constructor(
    platform: Store,
    store: TenantStore,
    tenant: Tenant,
    bus: EventBus,
    access: AccessService,
    config: AppConfig,
    extractor: JobExtractor = new RuleBasedExtractor(),
  ) {
    this.platform = platform;
    this.store = store;
    this.tenant = tenant;
    this.bus = bus;
    this.access = access;
    this.config = config;
    this.extractor = extractor;
  }

  async uploadPost(input: UploadInput): Promise<{ draft: JobDraft }> {
    const text = input.text.trim();
    if (text.length === 0) {
      throw AppError.badRequest(
        'empty_post',
        'Paste the poster text or the WhatsApp message. An image on its own carries no text to read.',
      );
    }
    const extraction = await this.extractor.extract(text);
    const draft = this.store.createDraft({
      employerId: input.employerId ?? null,
      employerNameGuess: input.employerName ?? extraction.job.employerName,
      intakeChannel: input.channel,
      rawText: text,
      sourceImagePath: input.imagePath ?? null,
      extraction,
      createdBy: input.staffId,
    });
    this.bus.publish('agency', AGENCY_SCOPE_ID, 'draft_created', {
      draftId: draft.id,
      title: extraction.job.title,
      needsReview: extraction.needsReview,
    });
    return { draft };
  }

  /**
   * An employer client typing a vacancy into their own page, instead of
   * sending it to the agency. It lands in the same review queue as an uploaded
   * poster and goes live only when agency staff publish it, so the agency stays
   * in the loop and the listings stay consistent.
   */
  submitFromEmployer(input: EmployerSubmission): JobDraft {
    const employer = this.store.getEmployer(input.employerId);
    if (employer === null) throw AppError.notFound('Employer client not found.');
    if (this.store.countPendingDraftsForEmployer(employer.id) >= MAX_PENDING_EMPLOYER_DRAFTS) {
      throw AppError.conflict(
        'too_many_pending',
        'You have several vacancies waiting for the agency to review. Please wait for those before adding more.',
      );
    }

    const salary = withMonthlyTzs({
      amountMin: input.salaryAmountMin,
      amountMax: input.salaryAmountMax,
      currency: input.salaryCurrency,
      period: input.salaryPeriod,
      plusTips: input.salaryPlusTips,
    });

    const job: ExtractedJob = {
      title: input.title,
      employerName: employer.name,
      location: input.location,
      category: input.category,
      positions: input.positions,
      salary,
      description: input.description,
      responsibilities: input.responsibilities,
      requirements: input.requirements,
      applicationDeadline: input.applicationDeadline,
      contactInfo: employer.contactPhone ?? employer.contactEmail,
      accommodationProvided: input.accommodationProvided,
      languages: input.languages,
      experienceNote: input.experienceNote,
      certificateRequired: input.certificateRequired,
      immediateStart: input.immediateStart,
    };

    // Nothing was inferred here - the client typed it - so every field it
    // filled is recorded as stated, and none are flagged as uncertain.
    const evidence = `typed by ${employer.name}`;
    const confidence = (Object.keys(job) as (keyof ExtractedJob)[])
      .filter((field) => {
        const value = job[field];
        return Array.isArray(value) ? value.length > 0 : value !== null;
      })
      .map((field) => ({ field, confidence: 0.95, evidence }));

    const draft = this.store.createDraft({
      employerId: employer.id,
      employerNameGuess: employer.name,
      intakeChannel: 'employer_form',
      rawText: renderSubmission(input, employer.name, salary),
      sourceImagePath: null,
      extraction: {
        job,
        confidence,
        needsReview: [],
        extractor: 'employer-form-v1',
        detectedLanguage: 'en',
      },
      createdBy: `employer:${employer.id}`,
    });

    this.bus.publish('agency', AGENCY_SCOPE_ID, 'job_submitted_by_employer', {
      draftId: draft.id,
      employerId: employer.id,
      employerName: employer.name,
      title: input.title,
      positions: input.positions,
    });
    return draft;
  }

  /** Staff fixing what Kobe AI got wrong, before publishing. */
  saveCorrections(draftId: string, corrections: Record<string, unknown>, employerId: string | null): JobDraft {
    const draft = this.store.getDraft(draftId);
    if (draft === null) throw AppError.notFound('Draft not found.');
    if (draft.status === 'published') throw AppError.conflict('already_published', 'This draft is already published.');
    this.store.saveDraftCorrections(draftId, { ...(draft.overrides ?? {}), ...corrections }, employerId);
    const updated = this.store.getDraft(draftId);
    if (updated === null) throw AppError.notFound('Draft not found.');
    return updated;
  }

  publishDraft(draftId: string, options: PublishOptions): PublishResult {
    const draft = this.store.getDraft(draftId);
    if (draft === null) throw AppError.notFound('Draft not found.');
    if (draft.status === 'published') throw AppError.conflict('already_published', 'This draft is already published.');

    const merged = mergeOverrides(draft.extraction.job, draft.overrides);
    const missing = REQUIRED.filter((field) => merged[field] === null);
    if (missing.length > 0) {
      throw AppError.badRequest('incomplete_job', `Fill in ${missing.join(', ')} before publishing.`, { missing });
    }

    const employerName = options.employerName ?? draft.employerNameGuess ?? merged.employerName ?? null;
    const employerId = options.employerId ?? draft.employerId ?? null;
    if (employerId === null && employerName === null) {
      throw AppError.badRequest('employer_required', 'Choose the employer client this job belongs to.');
    }

    return this.store.transaction(() => {
      const { employer, created } = this.resolveEmployer(employerId, employerName, options);

      const job = this.store.insertJob({
        id: newId('job'),
        employerId: employer.id,
        reference: this.store.nextJobReference(this.referencePrefix()),
        status: 'published',
        title: merged.title ?? 'Vacancy',
        location: merged.location ?? '',
        category: merged.category ?? 'other',
        positions: merged.positions ?? 1,
        salary: merged.salary as Salary,
        description: merged.description,
        responsibilities: merged.responsibilities,
        requirements: merged.requirements,
        applicationDeadline: merged.applicationDeadline,
        contactInfo: merged.contactInfo,
        accommodationProvided: merged.accommodationProvided ?? false,
        languages: merged.languages,
        experienceNote: merged.experienceNote,
        certificateRequired: merged.certificateRequired ?? false,
        immediateStart: merged.immediateStart ?? false,
        sourceImagePath: draft.sourceImagePath,
        sourceText: draft.rawText,
        intakeChannel: draft.intakeChannel,
        publishedAt: new Date().toISOString(),
      });

      this.store.markDraftPublished(draft.id, job.id, employer.id);

      // A brand-new client needs a way in; an existing one keeps their code.
      const accessCode = created ? this.access.issueAccessCode(employer.id) : null;
      const employerLink = this.linkFor(employer.accessCode);

      const payload = {
        jobId: job.id,
        title: job.title,
        employerId: employer.id,
        employerName: employer.name,
        positions: job.positions,
        employerLink,
      };
      this.bus.publish('employer', employer.id, 'job_published', payload);
      this.bus.publish('agency', AGENCY_SCOPE_ID, 'job_published', payload);

      return { job, employerId: employer.id, employerName: employer.name, employerLink, accessCode };
    });
  }

  /** Finds the client or creates it, with its short code, on first sight. */
  private resolveEmployer(
    employerId: string | null,
    employerName: string | null,
    contact: { contactName?: string | null; contactPhone?: string | null; contactEmail?: string | null },
  ): { employer: ReturnType<TenantStore['createEmployer']>; created: boolean } {
    if (employerId !== null) {
      const existing = this.store.getEmployer(employerId);
      if (existing === null) throw AppError.notFound('Employer client not found.');
      this.store.updateEmployerContact(existing.id, contact);
      return { employer: existing, created: false };
    }

    const name = (employerName ?? '').trim();
    const byName = this.store.findEmployerByName(name);
    if (byName !== null) {
      this.store.updateEmployerContact(byName.id, contact);
      return { employer: byName, created: false };
    }

    const employer = this.store.createEmployer({
      name,
      accessCode: this.uniqueAccessCode(),
      contactName: contact.contactName ?? null,
      contactPhone: contact.contactPhone ?? null,
      contactEmail: contact.contactEmail ?? null,
    });
    return { employer, created: true };
  }

  linkFor(accessCode: string): string {
    return `${this.config.publicBaseUrl}/e/${accessCode}`;
  }

  private uniqueAccessCode(): string {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = randomShortCode();
      if (!this.platform.accessCodeTaken(code)) return code;
    }
    throw new Error('could not allocate a unique employer access code');
  }

  /** Job references read like SH-JOB-2026-0007, from the tenant's initials. */
  private referencePrefix(): string {
    const initials = this.tenant.name
      .split(/\s+/)
      .map((word) => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 3);
    return initials.length >= 2 ? initials : 'KOB';
  }
}
