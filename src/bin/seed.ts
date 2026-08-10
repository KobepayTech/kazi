/**
 * Seeds the MVP loop end to end: the agency uploads posters it already sent
 * out, applicants register and pay, staff confirm the payments, applicants
 * swipe right, and one employer works through its candidates.
 *
 *   node src/bin/seed.ts [--force]
 */
import { createPlatform } from '../app.ts';
import type { Actor, JobCategory } from '../domain/types.ts';

const force = process.argv.includes('--force');
const platform = createPlatform();
const kobe = platform.tenantContext(platform.defaultTenant.id);

if (kobe.store.listEmployers().length > 0 && !force) {
  console.log('Database already has data. Re-run with --force to add the demo on top of it.');
  process.exit(0);
}

const staff: Actor = { kind: 'agency', id: 'staff_amina' };

const POSTERS = [
  {
    employerName: 'Zanzibar Resort',
    contactName: 'Salma Khamis',
    contactPhone: '+255777000111',
    contactEmail: 'hr@zanzibarresort.example',
    channel: 'whatsapp_text' as const,
    imagePath: null,
    text: [
      'AJIRA EXCLUSIVE - SOKO HURU',
      'We require eight female hotel attendants.',
      'Location: Zanzibar',
      'Salary: USD 200 plus tips',
      'Accommodation provided',
      'English required',
      'Hospitality experience preferred',
      'Ready to start immediately',
      'Contact: 0777 000 111',
    ].join('\n'),
  },
  {
    employerName: 'ABC Call Centre',
    contactName: 'Peter Mlay',
    contactPhone: '+255777000222',
    contactEmail: 'jobs@abccall.example',
    channel: 'pasted_text' as const,
    imagePath: null,
    text: [
      'Job title: Call Centre Agent',
      'Company: ABC Call Centre',
      'Location: Dar es Salaam',
      'Positions: 12',
      'Salary: TSh 450,000 per month',
      'Languages: English and Swahili',
      'Responsibilities:',
      'Answer customer calls',
      'Log every complaint in the system',
      'Requirements:',
      'Form four and above',
      '1 year customer care experience preferred',
      'Deadline: 2026-09-15',
    ].join('\n'),
  },
  {
    employerName: 'City Logistics',
    contactName: 'John Massawe',
    contactPhone: '+255777000333',
    contactEmail: null,
    channel: 'pasted_text' as const,
    imagePath: null,
    text: [
      'Tunahitaji madereva 15 wa malori.',
      'Eneo: Dar es Salaam',
      'Mshahara: TSh 600,000 kwa mwezi',
      'Uzoefu: miaka 3 ya kuendesha malori',
      'Cheti kinahitajika: leseni daraja C',
      'Chakula na malazi hutolewa safarini',
      'Anza mara moja',
    ].join('\n'),
  },
];

const published = [];
for (const poster of POSTERS) {
  const { draft } = await kobe.intake.uploadPost({
    channel: poster.channel,
    text: poster.text,
    imagePath: poster.imagePath,
    employerName: poster.employerName,
    staffId: staff.id,
  });
  console.log(`Extracted "${draft.extraction.job.title}" for ${poster.employerName}`);
  if (draft.extraction.needsReview.length > 0) {
    console.log(`  staff to check: ${draft.extraction.needsReview.join(', ')}`);
  }
  const result = kobe.intake.publishDraft(draft.id, {
    staffId: staff.id,
    employerName: poster.employerName,
    contactName: poster.contactName,
    contactPhone: poster.contactPhone,
    contactEmail: poster.contactEmail,
  });
  published.push(result);
  console.log(`  published -> ${result.employerLink}`);
  if (result.accessCode !== null) console.log(`  employer access code: ${result.accessCode.secret}`);
}

const APPLICANTS = [
  {
    fullName: 'Neema Joseph',
    phone: '+255711000001',
    location: 'Dar es Salaam',
    categories: ['hospitality'] as JobCategory[],
    experienceYears: 2,
    educationLevel: 'secondary' as const,
    skills: ['Housekeeping', 'Guest relations'],
    languages: ['English', 'Swahili'],
    willingToRelocate: true,
    planCode: 'non_certificate',
  },
  {
    fullName: 'Asha Mwinyi',
    phone: '+255711000002',
    location: 'Zanzibar',
    categories: ['hospitality'] as JobCategory[],
    experienceYears: 4,
    educationLevel: 'certificate' as const,
    skills: ['Housekeeping', 'Team leading'],
    languages: ['English', 'Swahili', 'Italian'],
    willingToRelocate: false,
    planCode: 'certificate',
  },
  {
    fullName: 'Juma Salehe',
    phone: '+255711000003',
    location: 'Dar es Salaam',
    categories: ['driving'] as JobCategory[],
    experienceYears: 6,
    educationLevel: 'secondary' as const,
    skills: ['Long haul', 'Vehicle maintenance'],
    languages: ['Swahili', 'English'],
    willingToRelocate: true,
    planCode: 'certificate',
  },
  {
    fullName: 'Fatuma Ally',
    phone: '+255711000004',
    location: 'Dar es Salaam',
    categories: ['customer_care'] as JobCategory[],
    experienceYears: 1,
    educationLevel: 'secondary' as const,
    skills: ['Inbound calls', 'CRM'],
    languages: ['English', 'Swahili'],
    willingToRelocate: true,
    planCode: 'non_certificate',
  },
];

const sessions: { name: string; applicantId: string; token: string }[] = [];
for (const person of APPLICANTS) {
  const { applicant } = kobe.applicants.register({
    fullName: person.fullName,
    phone: person.phone,
    location: person.location,
    educationLevel: person.educationLevel,
    experienceYears: person.experienceYears,
    skills: person.skills,
    languages: person.languages,
    willingToRelocate: person.willingToRelocate,
    categories: person.categories,
  });
  const issued = kobe.access.startApplicantSession(applicant.id);
  sessions.push({ name: person.fullName, applicantId: applicant.id, token: issued.token });

  // Pay, submit the reference, agency confirms.
  const plan = kobe.store.getPlan(person.planCode);
  const { payment } = kobe.memberships.submitPayment({
    applicantId: applicant.id,
    planCode: person.planCode,
    amountTzs: plan?.priceTzs ?? 0,
    reference: `MPESA-${person.phone.slice(-6)}`,
  });
  kobe.memberships.confirmPayment(payment.id, staff.id);
  console.log(`Registered ${person.fullName} on the ${plan?.name ?? person.planCode} package`);
}

// Applicants swipe right on the top card their filters produced. The first
// call returns the confirmation prompt; the second one actually applies.
for (const { name, applicantId } of sessions) {
  for (const card of kobe.swipe.feed(applicantId, 3)) {
    const prompt = kobe.swipe.swipe(applicantId, card.jobId, 'right');
    if (prompt.result !== 'confirm_required') continue;
    const outcome = kobe.swipe.swipe(applicantId, card.jobId, 'right', true);
    if (outcome.result === 'applied') {
      console.log(`${name} applied to ${card.title} -> ${outcome.confirmation.applicationNumber}`);
    } else if (outcome.result === 'blocked') {
      console.log(`${name} blocked on ${card.title}: ${outcome.message}`);
    }
  }
}

// The Zanzibar client works through its first candidates.
const zanzibar = published[0];
if (zanzibar !== undefined) {
  const actor: Actor = { kind: 'employer', id: zanzibar.employerId };
  const candidates = kobe.employer.candidates(zanzibar.employerId, { jobId: zanzibar.job.id });
  candidates.forEach((entry, index) => {
    kobe.employer.openCandidate(zanzibar.employerId, entry.application.id, actor);
    if (index === 0) {
      kobe.employer.shortlist(zanzibar.employerId, entry.application.id, actor, 'Strong resort experience');
      kobe.employer.inviteToInterview(zanzibar.employerId, entry.application.id, actor, 'Interview at the resort');
    }
  });
  console.log('\nZanzibar Resort page:', kobe.store.jobStats(zanzibar.job.id));
  console.log(`Employer link: ${zanzibar.employerLink}`);
}

console.log('\nAgency admin');
for (const row of kobe.agency.overview()) {
  console.log(
    `  ${row.employerName.padEnd(20)} ${row.jobTitle.padEnd(24)} ${String(row.applications).padStart(3)} applicants` +
      `  ${String(row.shortlisted).padStart(2)} shortlisted  ${String(row.hired).padStart(2)} hired`,
  );
}

console.log('\nApplicant app tokens');
for (const entry of sessions) {
  console.log(`  ${entry.name.padEnd(16)} ${entry.applicantId}  ${entry.token}`);
}

platform.close();
