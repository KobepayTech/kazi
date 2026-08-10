import type { AppConfig } from '../config.ts';
import type { JobDraft, TenantStore } from '../data/store.ts';
import { RuleBasedExtractor } from '../domain/extraction.ts';
import { newId, randomShortCode } from '../domain/ids.ts';
import { withMonthlyTzs } from '../domain/salary.ts';
import type { ExtractedJob, IntakeChannel, Job, JobExtractor, Salary, Tenant } from '../domain/types.ts';
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
