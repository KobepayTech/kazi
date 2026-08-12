import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlatform, type Platform, type TenantContext } from '../src/app.ts';
import type { Applicant, Job, JobCategory } from '../src/domain/types.ts';

export type Harness = {
  platform: Platform;
  kobe: TenantContext;
  close(): void;
};

/**
 * A throwaway KobeOS: in-memory database, uploads in a temp directory that is
 * removed on close, so a test run never leaves anything in the working tree.
 */
export function makeHarness(): Harness {
  const uploadsDir = mkdtempSync(join(tmpdir(), 'kobeos-test-'));
  const platform = createPlatform({
    config: {
      databasePath: ':memory:',
      publicBaseUrl: 'https://jobs.kobeos.test',
      uploadsDir,
      defaultTenantName: 'Soko Huru',
      defaultTenantSlug: 'soko-huru',
      defaultTenantApiKey: 'test-agency-key',
    },
  });
  return {
    platform,
    kobe: platform.tenantContext(platform.defaultTenant.id),
    close: () => {
      platform.close();
      rmSync(uploadsDir, { recursive: true, force: true });
    },
  };
}

export const ZANZIBAR_POSTER = [
  'AJIRA EXCLUSIVE - SOKO HURU',
  'We require eight female hotel attendants.',
  'Location: Zanzibar',
  'Salary: USD 200 plus tips',
  'Accommodation provided',
  'English required',
  'Hospitality experience preferred',
  'Ready to start immediately',
].join('\n');

export type PublishResult = {
  job: Job;
  employerId: string;
  employerLink: string;
  accessCode: string | null;
};

export async function publish(
  context: TenantContext,
  options: { text?: string; employerName?: string; imagePath?: string | null; contactPhone?: string | null } = {},
): Promise<PublishResult> {
  const { draft } = await context.intake.uploadPost({
    channel: 'whatsapp_text',
    text: options.text ?? ZANZIBAR_POSTER,
    imagePath: options.imagePath ?? null,
    employerName: options.employerName ?? 'Zanzibar Resort',
    staffId: 'staff_test',
  });
  const result = context.intake.publishDraft(draft.id, {
    staffId: 'staff_test',
    employerName: options.employerName ?? 'Zanzibar Resort',
    contactPhone: options.contactPhone ?? null,
  });
  return {
    job: result.job,
    employerId: result.employerId,
    employerLink: result.employerLink,
    accessCode: result.accessCode?.secret ?? null,
  };
}

export type ApplicantOptions = {
  fullName?: string;
  phone?: string;
  location?: string;
  categories?: JobCategory[];
  experienceYears?: number;
  languages?: string[];
  willingToRelocate?: boolean;
  minSalaryTzs?: number | null;
  /** null registers the applicant without paying for anything. */
  planCode?: string | null;
  /** Leaves the payment submitted but unconfirmed. */
  confirmPayment?: boolean;
};

let phoneCounter = 0;

/** Registers an applicant and, unless told otherwise, gets them a live membership. */
export function makeApplicant(
  context: TenantContext,
  options: ApplicantOptions = {},
): { applicant: Applicant; token: string } {
  phoneCounter += 1;
  const { applicant } = context.applicants.register({
    fullName: options.fullName ?? 'Neema Joseph',
    phone: options.phone ?? `+2557110000${String(phoneCounter).padStart(2, '0')}`,
    location: options.location ?? 'Dar es Salaam',
    educationLevel: 'secondary',
    experienceYears: options.experienceYears ?? 2,
    skills: ['Housekeeping'],
    languages: options.languages ?? ['English', 'Swahili'],
    willingToRelocate: options.willingToRelocate ?? true,
    categories: options.categories ?? ['hospitality'],
    minSalaryTzs: options.minSalaryTzs ?? null,
  });

  const planCode = options.planCode === undefined ? 'non_certificate' : options.planCode;
  if (planCode !== null) {
    const plan = context.store.getPlan(planCode);
    const { payment } = context.memberships.submitPayment({
      applicantId: applicant.id,
      planCode,
      amountTzs: plan?.priceTzs ?? 0,
      reference: `MPESA-${applicant.id.slice(-8)}`,
    });
    if (options.confirmPayment !== false) context.memberships.confirmPayment(payment.id, 'staff_test');
  }

  return { applicant, token: context.access.startApplicantSession(applicant.id).token };
}

/** Swipe right and confirm, the way the app does it. */
export function applyTo(context: TenantContext, applicantId: string, jobId: string) {
  const prompt = context.swipe.swipe(applicantId, jobId, 'right');
  if (prompt.result !== 'confirm_required') return prompt;
  return context.swipe.swipe(applicantId, jobId, 'right', true);
}
