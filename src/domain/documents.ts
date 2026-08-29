import type {
  Applicant,
  ApplicantDocument,
  ApplicantDocumentKind,
  Application,
  Cv,
  Job,
} from './types.ts';

export const APPLICATION_DOCUMENT_WINDOW_HOURS = 24;

export type RequiredApplicationDocumentKind = 'cv' | 'photo' | 'certificate' | 'licence' | 'identity';

export type RequiredApplicationDocument = {
  kind: RequiredApplicationDocumentKind;
  label: string;
  reason: string;
};

export type ApplicationDocumentItem = RequiredApplicationDocument & {
  satisfied: boolean;
  source: 'generated_cv' | 'profile_photo' | 'uploaded_document' | 'certificate_scan' | null;
  filePath: string | null;
  uploadedDocumentId: string | null;
};

export type ApplicationDocumentBundle = {
  applicationId: string;
  dueAt: string;
  complete: boolean;
  overdue: boolean;
  remainingMs: number;
  satisfiedCount: number;
  requiredCount: number;
  documents: ApplicationDocumentItem[];
};

function includesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * The application package is intentionally conservative. Kazi only marks a
 * document as required when the vacancy gives a strong signal for it.
 */
export function requiredApplicationDocuments(job: Job): RequiredApplicationDocument[] {
  const requirementsText = [
    job.title,
    job.description ?? '',
    job.experienceNote ?? '',
    ...job.requirements,
  ].join(' ').toLowerCase();

  const required: RequiredApplicationDocument[] = [
    { kind: 'cv', label: 'CV', reason: 'Every application includes a CV.' },
    { kind: 'photo', label: 'Profile photo', reason: 'Employers receive the applicant profile photo.' },
  ];

  const licenceRequired = includesAny(requirementsText, [
    /\bdriving licence\b/i,
    /\bdriver'?s license\b/i,
    /\bdriver'?s licence\b/i,
    /\blicen[cs]e\b/i,
    /\bleseni\b/i,
  ]);
  if (licenceRequired) {
    required.push({
      kind: 'licence',
      label: 'Licence',
      reason: 'The vacancy asks for a licence.',
    });
  } else if (job.certificateRequired) {
    required.push({
      kind: 'certificate',
      label: 'Certificate / qualification',
      reason: 'The vacancy requires a certificate or qualification.',
    });
  }

  const identityRequired = includesAny(requirementsText, [
    /\bnida\b/i,
    /\bnational id\b/i,
    /\bidentity card\b/i,
    /\bpassport\b/i,
    /\bkitambulisho\b/i,
  ]);
  if (identityRequired) {
    required.push({
      kind: 'identity',
      label: 'ID / passport',
      reason: 'The vacancy explicitly asks for identity documentation.',
    });
  }

  return required;
}

function newestDocument(
  documents: readonly ApplicantDocument[],
  kind: ApplicantDocumentKind,
): ApplicantDocument | null {
  return documents.find((document) => document.kind === kind) ?? null;
}

function findDocument(
  requirement: RequiredApplicationDocument,
  applicant: Applicant,
  cv: Cv,
  documents: readonly ApplicantDocument[],
): Pick<ApplicationDocumentItem, 'satisfied' | 'source' | 'filePath' | 'uploadedDocumentId'> {
  if (requirement.kind === 'cv') {
    const uploaded = newestDocument(documents, 'cv');
    if (uploaded !== null) {
      return {
        satisfied: true,
        source: 'uploaded_document',
        filePath: uploaded.filePath,
        uploadedDocumentId: uploaded.id,
      };
    }
    return {
      satisfied: true,
      source: 'generated_cv',
      filePath: null,
      uploadedDocumentId: null,
    };
  }

  if (requirement.kind === 'photo') {
    return {
      satisfied: applicant.photoPath !== null,
      source: applicant.photoPath === null ? null : 'profile_photo',
      filePath: applicant.photoPath,
      uploadedDocumentId: null,
    };
  }

  const uploaded = newestDocument(documents, requirement.kind);
  if (uploaded !== null) {
    return {
      satisfied: true,
      source: 'uploaded_document',
      filePath: uploaded.filePath,
      uploadedDocumentId: uploaded.id,
    };
  }

  if (requirement.kind === 'certificate') {
    const certificate = cv.certificates.find((entry) => entry.filePath !== null);
    if (certificate?.filePath) {
      return {
        satisfied: true,
        source: 'certificate_scan',
        filePath: certificate.filePath,
        uploadedDocumentId: null,
      };
    }
  }

  return { satisfied: false, source: null, filePath: null, uploadedDocumentId: null };
}

export function applicationDocumentBundle(input: {
  application: Application;
  job: Job;
  applicant: Applicant;
  cv: Cv;
  documents: readonly ApplicantDocument[];
  now?: Date;
}): ApplicationDocumentBundle {
  const now = input.now ?? new Date();
  const due = new Date(new Date(input.application.createdAt).getTime() + APPLICATION_DOCUMENT_WINDOW_HOURS * 60 * 60 * 1000);
  const requirements = requiredApplicationDocuments(input.job);
  const items = requirements.map((requirement): ApplicationDocumentItem => ({
    ...requirement,
    ...findDocument(requirement, input.applicant, input.cv, input.documents),
  }));
  const satisfiedCount = items.filter((item) => item.satisfied).length;
  const complete = satisfiedCount === items.length;
  const remainingMs = Math.max(0, due.getTime() - now.getTime());
  return {
    applicationId: input.application.id,
    dueAt: due.toISOString(),
    complete,
    overdue: !complete && now.getTime() >= due.getTime(),
    remainingMs,
    satisfiedCount,
    requiredCount: items.length,
    documents: items,
  };
}
