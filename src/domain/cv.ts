import type { Applicant, ApplicantPreferences, Cv, CvCertificate, EducationLevel, JobCategory } from './types.ts';

const EDUCATION_LABELS: Record<EducationLevel, string> = {
  none: 'No formal qualification',
  primary: 'Primary education',
  secondary: 'Secondary education',
  certificate: 'Certificate',
  diploma: 'Diploma',
  degree: 'Degree',
  postgraduate: 'Postgraduate',
};

function categoryLabel(category: JobCategory): string {
  return category.replace(/_/g, ' ');
}

export function headlineFor(applicant: Applicant, categories: readonly JobCategory[]): string {
  const field = categories.length > 0 ? categoryLabel(categories[0] as JobCategory) : 'work';
  if (applicant.experienceYears <= 0) return `Looking for ${field} work`;
  const years = applicant.experienceYears === 1 ? '1 year' : `${applicant.experienceYears} years`;
  return `${field.charAt(0).toUpperCase()}${field.slice(1)} · ${years} experience`;
}

export function summaryFor(
  applicant: Applicant,
  categories: readonly JobCategory[],
  certificates: readonly CvCertificate[],
): string {
  const parts: string[] = [];
  const field = categories.length > 0 ? categoryLabel(categories[0] as JobCategory) : 'general';
  parts.push(
    applicant.experienceYears > 0
      ? `${applicant.fullName} has ${applicant.experienceYears} year(s) of ${field} experience and is based in ${applicant.location}.`
      : `${applicant.fullName} is based in ${applicant.location} and is looking for ${field} work.`,
  );
  parts.push(`Education: ${EDUCATION_LABELS[applicant.educationLevel]}.`);
  if (applicant.skills.length > 0) parts.push(`Skills: ${applicant.skills.join(', ')}.`);
  if (applicant.languages.length > 0) parts.push(`Languages: ${applicant.languages.join(', ')}.`);
  if (certificates.length > 0) parts.push(`Certificates: ${certificates.map((entry) => entry.label).join(', ')}.`);
  parts.push(applicant.willingToRelocate ? 'Available to relocate.' : 'Prefers work near home.');
  return parts.join(' ');
}

/**
 * KobeOS writes the CV; the applicant never uploads one. Everything here comes
 * from the short registration form, so the CV is regenerated whenever the
 * profile or the certificate list changes.
 */
export function generateCv(
  applicant: Applicant,
  preferences: ApplicantPreferences | null,
  certificates: readonly CvCertificate[],
  id: string,
): Omit<Cv, 'generatedAt'> & { generatedAt: string } {
  const categories = preferences?.categories ?? [];
  return {
    id,
    tenantId: applicant.tenantId,
    applicantId: applicant.id,
    fullName: applicant.fullName,
    headline: headlineFor(applicant, categories),
    summary: summaryFor(applicant, categories, certificates),
    location: applicant.location,
    phone: applicant.phone,
    email: applicant.email,
    educationLevel: applicant.educationLevel,
    experienceYears: applicant.experienceYears,
    categories: [...categories],
    skills: [...applicant.skills],
    languages: [...applicant.languages],
    certificates: [...certificates],
    photoPath: applicant.photoPath,
    generatedAt: new Date().toISOString(),
  };
}

/** A plain-text rendering, which is what the employer downloads in the MVP. */
export function renderCvText(cv: Cv): string {
  const lines = [
    cv.fullName.toUpperCase(),
    cv.headline,
    '',
    `Location: ${cv.location}`,
    `Phone: ${cv.phone}`,
  ];
  if (cv.email !== null) lines.push(`Email: ${cv.email}`);
  lines.push('', 'SUMMARY', cv.summary);
  lines.push('', 'EDUCATION', EDUCATION_LABELS[cv.educationLevel]);
  lines.push('', 'EXPERIENCE', `${cv.experienceYears} year(s)`);
  if (cv.skills.length > 0) lines.push('', 'SKILLS', cv.skills.join(', '));
  if (cv.languages.length > 0) lines.push('', 'LANGUAGES', cv.languages.join(', '));
  if (cv.certificates.length > 0) {
    lines.push('', 'CERTIFICATES', ...cv.certificates.map((entry) => `- ${entry.label}`));
  }
  return lines.join('\n');
}
