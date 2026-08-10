import type { AppConfig } from '../config.ts';
import type { Store, VacancyDraft } from '../data/store.ts';
import { RuleBasedExtractor } from '../domain/extraction.ts';
import { newId } from '../domain/ids.ts';
import { withMonthlyTzs } from '../domain/salary.ts';
import { slugify } from '../domain/text.ts';
import type {
  ExtractedVacancy,
  ExtractionResult,
  IntakeChannel,
  Salary,
  Vacancy,
  VacancyExtractor,
} from '../domain/types.ts';
import { AppError } from './errors.ts';
import { AGENCY_SCOPE_ID, EventBus } from './events.ts';
import type { AccessService, IssuedSecret } from './access.ts';

export type UploadInput = {
  channel: IntakeChannel;
  /** The poster text, WhatsApp message or pasted advert. */
  text: string;
  /** Stored path of the original poster, still shown on the vacancy detail page. */
  imagePath?: string | null;
  employerId?: string | null;
  employerName?: string | null;
  staffId: string;
};

export type PublishOptions = {
  staffId: string;
  employerId?: string | null;
  employerName?: string | null;
  employerLocation?: string | null;
  employerContactEmail?: string | null;
  employerContactPhone?: string | null;
  description?: string | null;
};

export type PublishResult = {
  vacancy: Vacancy;
  employerId: string;
  employerName: string;
  portalUrl: string;
  vacancyUrl: string;
  /** Only present the first time a client portal is generated. */
  employerAccessCode: IssuedSecret | null;
};

const REQUIRED = ['title', 'location', 'category', 'positions', 'salary'] as const;

function mergeOverrides(extracted: ExtractedVacancy, overrides: Record<string, unknown> | null): ExtractedVacancy {
  if (overrides === null) return extracted;
  const merged: ExtractedVacancy = { ...extracted };
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
 * Step 3 of the workflow: Soko Huru uploads the poster or message it already
 * created, KobeOS extracts the vacancy, staff check the extraction, and
 * publishing turns it into both a swipe card and an employer portal.
 */
export class IntakeService {
  private readonly store: Store;
  private readonly bus: EventBus;
  private readonly access: AccessService;
  private readonly config: AppConfig;
  private readonly extractor: VacancyExtractor;

  constructor(
    store: Store,
    bus: EventBus,
    access: AccessService,
    config: AppConfig,
    extractor: VacancyExtractor = new RuleBasedExtractor(),
  ) {
    this.store = store;
    this.bus = bus;
    this.access = access;
    this.config = config;
    this.extractor = extractor;
  }

  /** Upload Vacancy Post: poster, screenshot, WhatsApp message, PDF text or manual entry. */
  async uploadPost(input: UploadInput): Promise<{ draft: VacancyDraft; extraction: ExtractionResult }> {
    const text = input.text.trim();
    if (text.length === 0) {
      throw AppError.badRequest(
        'empty_post',
        'Add the poster text, the WhatsApp message, or type the vacancy in manually. An image on its own carries no text to read.',
      );
    }
    const extraction = await this.extractor.extract(text);
    const employerName = input.employerName ?? extraction.vacancy.employerName;
    const draft = this.store.createDraft({
      employerId: input.employerId ?? null,
      employerNameGuess: employerName,
      intakeChannel: input.channel,
      rawText: text,
      sourceImagePath: input.imagePath ?? null,
      extraction,
      createdBy: input.staffId,
    });
    this.bus.publish('agency', AGENCY_SCOPE_ID, 'draft_created', {
      draftId: draft.id,
      title: extraction.vacancy.title,
      needsReview: extraction.needsReview,
    });
    return { draft, extraction };
  }

  /** Soko Huru staff correcting what Kobe AI read before publishing. */
  saveCorrections(draftId: string, corrections: Record<string, unknown>, employerId: string | null): VacancyDraft {
    const draft = this.store.getDraft(draftId);
    if (draft === null) throw AppError.notFound('Draft not found.');
    if (draft.status === 'published') throw AppError.conflict('already_published', 'This draft has already been published.');
    this.store.saveDraftCorrections(draftId, { ...(draft.overrides ?? {}), ...corrections }, employerId);
    const updated = this.store.getDraft(draftId);
    if (updated === null) throw AppError.notFound('Draft not found.');
    return updated;
  }

  /** The Publish button: creates the swipe card and the employer's portal. */
  publishDraft(draftId: string, options: PublishOptions): PublishResult {
    const draft = this.store.getDraft(draftId);
    if (draft === null) throw AppError.notFound('Draft not found.');
    if (draft.status === 'published') throw AppError.conflict('already_published', 'This draft has already been published.');

    const merged = mergeOverrides(draft.extraction.vacancy, draft.overrides);
    const missing = REQUIRED.filter((field) => merged[field] === null);
    if (missing.length > 0) {
      throw AppError.badRequest('incomplete_vacancy', `Fill in ${missing.join(', ')} before publishing.`, { missing });
    }

    const employerName =
      options.employerName ?? draft.employerNameGuess ?? merged.employerName ?? null;
    const employerId = options.employerId ?? draft.employerId ?? null;
    if (employerId === null && employerName === null) {
      throw AppError.badRequest('employer_required', 'Choose the employer client this vacancy belongs to.');
    }

    return this.store.transaction(() => {
      const { employer, portalCreated } = this.resolveEmployer(employerId, employerName, {
        location: options.employerLocation ?? merged.location,
        contactEmail: options.employerContactEmail ?? null,
        contactPhone: options.employerContactPhone ?? null,
      });

      const vacancy = this.store.insertVacancy({
        id: newId('vac'),
        employerId: employer.id,
        agencyRef: this.nextAgencyRef(),
        slug: this.uniqueVacancySlug(employer.id, merged.title ?? 'vacancy'),
        status: 'published',
        title: merged.title ?? 'Vacancy',
        location: merged.location ?? '',
        category: merged.category ?? 'other',
        positions: merged.positions ?? 1,
        salary: merged.salary as Salary,
        accommodationProvided: merged.accommodationProvided ?? false,
        mealsProvided: merged.mealsProvided ?? false,
        transportProvided: merged.transportProvided ?? false,
        employmentType: merged.employmentType ?? 'full_time',
        workMode: merged.workMode ?? 'onsite',
        genderRequirement: merged.genderRequirement ?? 'any',
        ageMin: merged.ageMin,
        ageMax: merged.ageMax,
        languages: merged.languages ?? [],
        experienceYearsMin: merged.experienceYearsMin ?? 0,
        experienceNote: merged.experienceNote,
        educationMin: merged.educationMin ?? 'none',
        certificateRequired: merged.certificateRequired ?? false,
        immediateStart: merged.immediateStart ?? false,
        startDate: merged.startDate,
        applicationDeadline: merged.applicationDeadline,
        description: options.description ?? null,
        sourceImagePath: draft.sourceImagePath,
        sourceText: draft.rawText,
        intakeChannel: draft.intakeChannel,
        publishedAt: new Date().toISOString(),
      });

      this.store.markDraftPublished(draft.id, vacancy.id, employer.id);

      const portalUrl = this.store.getPortalUrl(employer.id) ?? this.portalUrlFor(employer.slug);
      const vacancyUrl = `${portalUrl}/jobs/${vacancy.slug}`;

      // A brand-new client needs a way in; an existing one keeps the code they have.
      const employerAccessCode = portalCreated ? this.access.issueOneTimeCode(employer.id) : null;

      const payload = {
        vacancyId: vacancy.id,
        title: vacancy.title,
        employerId: employer.id,
        employerName: employer.name,
        positions: vacancy.positions,
        vacancyUrl,
      };
      this.bus.publish('employer', employer.id, 'vacancy_published', payload);
      this.bus.publish('agency', AGENCY_SCOPE_ID, 'vacancy_published', payload);

      return {
        vacancy,
        employerId: employer.id,
        employerName: employer.name,
        portalUrl,
        vacancyUrl,
        employerAccessCode,
      };
    });
  }

  /**
   * Finds the employer client or creates it, and generates the recruitment
   * portal the first time we see them. The employer never fills in a form.
   */
  private resolveEmployer(
    employerId: string | null,
    employerName: string | null,
    details: { location: string | null; contactEmail: string | null; contactPhone: string | null },
  ): { employer: ReturnType<Store['createEmployer']>; portalCreated: boolean } {
    if (employerId !== null) {
      const existing = this.store.getEmployer(employerId);
      if (existing === null) throw AppError.notFound('Employer client not found.');
      const portalCreated = this.ensurePortal(existing.id, existing.slug);
      return { employer: existing, portalCreated };
    }

    const name = (employerName ?? '').trim();
    const byName = this.store.findEmployerByName(name);
    if (byName !== null) {
      const portalCreated = this.ensurePortal(byName.id, byName.slug);
      return { employer: byName, portalCreated };
    }

    const slug = this.uniqueEmployerSlug(name);
    const employer = this.store.createEmployer({
      name,
      slug,
      location: details.location,
      contactEmail: details.contactEmail,
      contactPhone: details.contactPhone,
      portalUrl: this.portalUrlFor(slug),
    });
    return { employer, portalCreated: true };
  }

  private ensurePortal(employerId: string, slug: string): boolean {
    if (this.store.getPortalUrl(employerId) !== null) return false;
    this.store.setPortalUrl(employerId, this.portalUrlFor(slug));
    return true;
  }

  portalUrlFor(slug: string): string {
    return `${this.config.portalBaseUrl}/client/${slug}`;
  }

  private uniqueEmployerSlug(name: string): string {
    const base = slugify(name);
    let candidate = base;
    let counter = 2;
    while (this.store.slugTaken(candidate)) {
      candidate = `${base}-${counter}`;
      counter += 1;
    }
    return candidate;
  }

  private uniqueVacancySlug(employerId: string, title: string): string {
    const base = slugify(title);
    let candidate = base;
    let counter = 2;
    while (this.store.getVacancyBySlug(employerId, candidate) !== null) {
      candidate = `${base}-${counter}`;
      counter += 1;
    }
    return candidate;
  }

  private nextAgencyRef(): string {
    const year = new Date().getUTCFullYear();
    const sequence = this.store.countAgencyRefsForYear(year) + 1;
    return `SH-JOB-${year}-${String(sequence).padStart(4, '0')}`;
  }
}
