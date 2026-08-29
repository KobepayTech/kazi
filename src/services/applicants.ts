import type { TenantStore } from '../data/store.ts';
import { generateCv, renderCvText } from '../domain/cv.ts';
import { newId } from '../domain/ids.ts';
import type {
  Applicant,
  ApplicantDocument,
  ApplicantDocumentKind,
  ApplicantPreferences,
  Cv,
  CvCertificate,
  EducationLevel,
  JobCategory,
} from '../domain/types.ts';
import { AppError } from './errors.ts';

export type RegistrationInput = {
  fullName: string;
  phone: string;
  email?: string | null;
  location: string;
  educationLevel?: EducationLevel;
  experienceYears?: number;
  skills?: string[];
  languages?: string[];
  willingToRelocate?: boolean;
  photoPath?: string | null;
  certificates?: CvCertificate[];
  /** The four filters, captured during the same short form. */
  categories?: JobCategory[];
  preferredLocations?: string[];
  minSalaryTzs?: number | null;
  certificateRequired?: boolean | null;
};

export type ApplicantProfile = {
  applicant: Applicant;
  preferences: ApplicantPreferences;
  cv: Cv;
};

/**
 * Registration is one short form. KobeOS writes the CV from it - the applicant
 * never uploads one - and regenerates it whenever the profile changes.
 */
export class ApplicantService {
  private readonly store: TenantStore;

  constructor(store: TenantStore) {
    this.store = store;
  }

  register(input: RegistrationInput): ApplicantProfile {
    if (this.store.getApplicantByPhone(input.phone) !== null) {
      throw AppError.conflict('applicant_exists', 'That phone number is already registered.');
    }
    return this.store.transaction(() => {
      const applicant = this.store.createApplicant({
        fullName: input.fullName,
        phone: input.phone,
        email: input.email ?? null,
        location: input.location,
        educationLevel: input.educationLevel ?? 'none',
        experienceYears: input.experienceYears ?? 0,
        skills: input.skills ?? [],
        languages: input.languages ?? [],
        photoPath: input.photoPath ?? null,
        willingToRelocate: input.willingToRelocate ?? false,
      });

      const preferences = this.store.savePreferences({
        applicantId: applicant.id,
        categories: input.categories ?? [],
        locations: input.preferredLocations ?? [],
        minSalaryTzs: input.minSalaryTzs ?? null,
        certificateRequired: input.certificateRequired ?? null,
      });

      const cv = this.regenerateCv(applicant, preferences, input.certificates ?? []);
      return { applicant, preferences, cv };
    });
  }

  profile(applicantId: string): ApplicantProfile {
    const applicant = this.requireApplicant(applicantId);
    const preferences =
      this.store.getPreferences(applicantId) ??
      this.store.savePreferences({
        applicantId,
        categories: [],
        locations: [],
        minSalaryTzs: null,
        certificateRequired: null,
      });
    const cv = this.store.getCvByApplicant(applicantId) ?? this.regenerateCv(applicant, preferences, []);
    return { applicant, preferences, cv };
  }

  updateProfile(applicantId: string, input: Partial<RegistrationInput>): ApplicantProfile {
    const current = this.requireApplicant(applicantId);
    const applicant = this.store.updateApplicant(applicantId, {
      fullName: input.fullName ?? current.fullName,
      phone: input.phone ?? current.phone,
      email: input.email === undefined ? current.email : input.email,
      location: input.location ?? current.location,
      educationLevel: input.educationLevel ?? current.educationLevel,
      experienceYears: input.experienceYears ?? current.experienceYears,
      skills: input.skills ?? current.skills,
      languages: input.languages ?? current.languages,
      photoPath: input.photoPath === undefined ? current.photoPath : input.photoPath,
      willingToRelocate: input.willingToRelocate ?? current.willingToRelocate,
    });

    const existing = this.store.getCvByApplicant(applicantId);
    const preferences = this.store.getPreferences(applicantId);
    const cv = this.regenerateCv(applicant, preferences, input.certificates ?? existing?.certificates ?? []);
    return { applicant, preferences: preferences ?? this.profile(applicantId).preferences, cv };
  }

  savePreferences(applicantId: string, input: Omit<ApplicantPreferences, 'applicantId' | 'tenantId' | 'updatedAt'>): ApplicantPreferences {
    const applicant = this.requireApplicant(applicantId);
    const preferences = this.store.savePreferences({ applicantId, ...input });
    // The CV leads with the applicant's chosen category, so it follows filters.
    this.regenerateCv(applicant, preferences, this.store.getCvByApplicant(applicantId)?.certificates ?? []);
    return preferences;
  }

  addCertificate(applicantId: string, certificate: CvCertificate): Cv {
    const applicant = this.requireApplicant(applicantId);
    const existing = this.store.getCvByApplicant(applicantId);
    const certificates = [...(existing?.certificates ?? []), certificate];
    return this.regenerateCv(applicant, this.store.getPreferences(applicantId), certificates);
  }

  documents(applicantId: string): ApplicantDocument[] {
    this.requireApplicant(applicantId);
    return this.store.listApplicantDocuments(applicantId);
  }

  addDocument(
    applicantId: string,
    input: {
      kind: ApplicantDocumentKind;
      label: string;
      filePath: string;
      filename: string;
      contentType: string;
    },
  ): ApplicantDocument {
    this.requireApplicant(applicantId);
    return this.store.addApplicantDocument({
      applicantId,
      ...input,
      replaceKind: input.kind === 'cv',
    });
  }

  removeDocument(applicantId: string, documentId: string): boolean {
    this.requireApplicant(applicantId);
    return this.store.deleteApplicantDocument(applicantId, documentId);
  }

  cv(applicantId: string): Cv {
    return this.profile(applicantId).cv;
  }

  cvText(applicantId: string): string {
    return renderCvText(this.cv(applicantId));
  }

  private regenerateCv(
    applicant: Applicant,
    preferences: ApplicantPreferences | null,
    certificates: readonly CvCertificate[],
  ): Cv {
    const existingId = this.store.getCvByApplicant(applicant.id)?.id ?? newId('cv');
    return this.store.saveCv(generateCv(applicant, preferences, certificates, existingId));
  }

  private requireApplicant(applicantId: string): Applicant {
    const applicant = this.store.getApplicant(applicantId);
    if (applicant === null) throw AppError.notFound('Applicant not found.');
    return applicant;
  }
}
