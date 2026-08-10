import { createApp, type Kobeos } from '../src/app.ts';
import type { Applicant, Cv, JobCategory, Vacancy } from '../src/domain/types.ts';

/** A throwaway KobeOS running entirely in memory. */
export function makeApp(): Kobeos {
  return createApp({ config: { databasePath: ':memory:', portalBaseUrl: 'https://sokohuru.test' } });
}

export const ZANZIBAR_POSTER = [
  'AJIRA EXCLUSIVE - SOKO HURU',
  'We require eight female hotel attendants.',
  'Location: Zanzibar',
  'Salary: USD 200 plus tips',
  'Accommodation provided',
  'English required',
  'Hospitality experience preferred',
  'Age: 18-35',
  'Ready to start immediately',
].join('\n');

export async function publish(
  app: Kobeos,
  options: { text?: string; employerName?: string; staffId?: string } = {},
): Promise<{ vacancy: Vacancy; employerId: string; portalUrl: string; vacancyUrl: string; accessCode: string | null }> {
  const staffId = options.staffId ?? 'staff_test';
  const { draft } = await app.intake.uploadPost({
    channel: 'whatsapp_text',
    text: options.text ?? ZANZIBAR_POSTER,
    employerName: options.employerName ?? 'Zanzibar Resort',
    staffId,
  });
  const result = app.intake.publishDraft(draft.id, { staffId, employerName: options.employerName ?? 'Zanzibar Resort' });
  return {
    vacancy: result.vacancy,
    employerId: result.employerId,
    portalUrl: result.portalUrl,
    vacancyUrl: result.vacancyUrl,
    accessCode: result.employerAccessCode?.secret ?? null,
  };
}

export type ApplicantOptions = {
  fullName?: string;
  phone?: string;
  location?: string;
  gender?: Applicant['gender'];
  dateOfBirth?: string;
  languages?: string[];
  willingToRelocate?: boolean;
  categories?: JobCategory[];
  experienceYears?: number;
  educationLevel?: Cv['educationLevel'];
  packageCode?: string | null;
  preferredSalaryTzs?: number | null;
};

/** Registers an applicant with a CV and, unless told otherwise, a paid membership. */
export function makeApplicant(app: Kobeos, options: ApplicantOptions = {}): { applicant: Applicant; cv: Cv } {
  const applicant = app.agency.registerApplicant({
    fullName: options.fullName ?? 'Neema Joseph',
    phone: options.phone ?? `+2557110000${Math.floor(Math.random() * 90 + 10)}`,
    location: options.location ?? 'Dar es Salaam',
    gender: options.gender ?? 'female',
    dateOfBirth: options.dateOfBirth ?? '2001-04-12',
    educationLevel: options.educationLevel ?? 'secondary',
    languages: options.languages ?? ['English', 'Swahili'],
    willingToRelocate: options.willingToRelocate ?? true,
    verified: true,
  });

  const cv = app.store.addCv({
    applicantId: applicant.id,
    label: 'Hospitality CV',
    categories: options.categories ?? ['hospitality'],
    headline: 'Hotel attendant',
    experienceYears: options.experienceYears ?? 2,
    educationLevel: options.educationLevel ?? 'secondary',
    skills: ['Housekeeping'],
    languages: options.languages ?? ['English', 'Swahili'],
    certificates: [],
    preferredSalaryTzs: options.preferredSalaryTzs ?? null,
    filePath: null,
    isDefault: true,
  });

  const packageCode = options.packageCode === undefined ? 'non_certificate' : options.packageCode;
  if (packageCode !== null) {
    const membership = app.memberships.purchase(applicant.id, packageCode);
    const pkg = app.store.getPackage(packageCode);
    app.memberships.confirmPayment(membership.id, pkg?.priceTzs ?? 0, 'MPESA-TEST');
  }

  return { applicant, cv };
}
