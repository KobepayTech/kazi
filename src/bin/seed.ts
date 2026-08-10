/**
 * Seeds the exact scenario from the workflow: a Zanzibar hotel sends a vacancy
 * to Soko Huru, Soko Huru uploads its poster to KobeOS, applicants swipe, and
 * the employer's page fills up in real time.
 *
 *   node src/bin/seed.ts [--force]
 */
import { createApp } from '../app.ts';
import type { Actor } from '../domain/types.ts';

const force = process.argv.includes('--force');
const app = createApp();

if (app.store.listEmployers().length > 0 && !force) {
  console.log('Database already has data. Re-run with --force to add the demo on top of it.');
  process.exit(0);
}

const staff: Actor = { kind: 'agency', id: 'staff_amina' };

const POSTERS = [
  {
    employerName: 'Zanzibar Resort',
    channel: 'whatsapp_text' as const,
    text: [
      'AJIRA EXCLUSIVE - SOKO HURU',
      'We require eight female hotel attendants.',
      'Location: Zanzibar',
      'Salary: USD 200 plus tips',
      'Accommodation provided',
      'English required',
      'Hospitality experience preferred',
      'Age: 18-35',
      'Ready to start immediately',
    ].join('\n'),
    imagePath: '/uploads/posters/zanzibar-resort-attendants.jpg',
  },
  {
    employerName: 'ABC Call Centre',
    channel: 'poster_image' as const,
    text: [
      'AJIRA EXCLUSIVE - SOKO HURU',
      'Job title: Call Centre Agent',
      'Company: ABC Call Centre',
      'Location: Dar es Salaam',
      'Positions: 12',
      'Salary: TSh 450,000 per month',
      'Education: Form four and above',
      'Languages: English and Swahili',
      'Experience: 1 year customer care experience preferred',
      'Employment type: Full time',
    ].join('\n'),
    imagePath: '/uploads/posters/abc-call-centre.jpg',
  },
  {
    employerName: 'City Logistics',
    channel: 'pasted_text' as const,
    text: [
      'Tunahitaji madereva 15 wa malori.',
      'Eneo: Dar es Salaam',
      'Mshahara: TSh 600,000 kwa mwezi',
      'Uzoefu: miaka 3 ya kuendesha malori',
      'Cheti kinahitajika: leseni daraja C',
      'Chakula na malazi hutolewa safarini',
      'Anza mara moja',
    ].join('\n'),
    imagePath: null,
  },
  {
    employerName: 'Mwanga Private School',
    channel: 'manual_entry' as const,
    text: [
      'Job title: Secondary School Teacher',
      'Company: Mwanga Private School',
      'Location: Arusha',
      'Positions: 4',
      'Salary: TSh 700,000 per month',
      'Education: Degree in education',
      'Certificate required',
      'Experience: 2 years teaching experience',
      'Accommodation: provided',
      'Languages: English',
    ].join('\n'),
    imagePath: null,
  },
];

const published = [];
for (const poster of POSTERS) {
  const { draft, extraction } = await app.intake.uploadPost({
    channel: poster.channel,
    text: poster.text,
    imagePath: poster.imagePath,
    employerName: poster.employerName,
    staffId: staff.id,
  });
  console.log(`Extracted "${extraction.vacancy.title}" for ${poster.employerName}`);
  if (extraction.needsReview.length > 0) {
    console.log(`  staff to check: ${extraction.needsReview.join(', ')}`);
  }
  const result = app.intake.publishDraft(draft.id, {
    staffId: staff.id,
    employerName: poster.employerName,
  });
  published.push(result);
  console.log(`  published -> ${result.vacancyUrl}`);
  if (result.employerAccessCode !== null) {
    console.log(`  employer access code: ${result.employerAccessCode.secret}`);
  }
}

const APPLICANTS = [
  {
    fullName: 'Neema Joseph',
    phone: '+255711000001',
    location: 'Dar es Salaam',
    gender: 'female' as const,
    dateOfBirth: '2001-04-12',
    languages: ['English', 'Swahili'],
    willingToRelocate: true,
    cv: {
      label: 'Hospitality CV',
      categories: ['hospitality' as const],
      headline: 'Hotel attendant with two years in beach resorts',
      experienceYears: 2,
      educationLevel: 'secondary' as const,
      skills: ['Housekeeping', 'Guest relations', 'Front desk'],
      certificates: ['Food hygiene basics'],
      preferredSalaryTzs: 400_000,
    },
    packageCode: 'non_certificate',
  },
  {
    fullName: 'Asha Mwinyi',
    phone: '+255711000002',
    location: 'Zanzibar',
    gender: 'female' as const,
    dateOfBirth: '1999-09-03',
    languages: ['English', 'Swahili', 'Italian'],
    willingToRelocate: false,
    cv: {
      label: 'Hospitality CV',
      categories: ['hospitality' as const],
      headline: 'Resort housekeeping supervisor',
      experienceYears: 4,
      educationLevel: 'certificate' as const,
      skills: ['Housekeeping', 'Team leading', 'Stock control'],
      certificates: ['Certificate in hotel operations'],
      preferredSalaryTzs: 450_000,
    },
    packageCode: 'certificate',
  },
  {
    fullName: 'Juma Salehe',
    phone: '+255711000003',
    location: 'Dar es Salaam',
    gender: 'male' as const,
    dateOfBirth: '1993-01-22',
    languages: ['Swahili', 'English'],
    willingToRelocate: true,
    cv: {
      label: 'Driving CV',
      categories: ['driving' as const],
      headline: 'Truck driver, class C licence, 6 years long haul',
      experienceYears: 6,
      educationLevel: 'secondary' as const,
      skills: ['Long haul', 'Vehicle maintenance', 'Route planning'],
      certificates: ['Class C driving licence'],
      preferredSalaryTzs: 550_000,
    },
    packageCode: 'certificate',
  },
  {
    fullName: 'Grace Mushi',
    phone: '+255711000004',
    location: 'Arusha',
    gender: 'female' as const,
    dateOfBirth: '1995-06-18',
    languages: ['English', 'Swahili'],
    willingToRelocate: false,
    cv: {
      label: 'Teaching CV',
      categories: ['teaching' as const],
      headline: 'Secondary school teacher of biology and chemistry',
      experienceYears: 3,
      educationLevel: 'degree' as const,
      skills: ['Lesson planning', 'Laboratory work'],
      certificates: ['Bachelor of Education'],
      preferredSalaryTzs: 650_000,
    },
    packageCode: 'certificate',
  },
  {
    fullName: 'Fatuma Ally',
    phone: '+255711000005',
    location: 'Dar es Salaam',
    gender: 'female' as const,
    dateOfBirth: '2002-11-30',
    languages: ['English', 'Swahili'],
    willingToRelocate: true,
    cv: {
      label: 'Customer care CV',
      categories: ['customer_care' as const, 'sales' as const],
      headline: 'Call centre agent, one year inbound support',
      experienceYears: 1,
      educationLevel: 'secondary' as const,
      skills: ['Inbound calls', 'CRM', 'Complaint handling'],
      certificates: [],
      preferredSalaryTzs: 400_000,
    },
    packageCode: 'non_certificate',
  },
];

const applicantIds: Record<string, string> = {};
for (const person of APPLICANTS) {
  const applicant = app.agency.registerApplicant({
    fullName: person.fullName,
    phone: person.phone,
    location: person.location,
    gender: person.gender,
    dateOfBirth: person.dateOfBirth,
    educationLevel: person.cv.educationLevel,
    languages: person.languages,
    willingToRelocate: person.willingToRelocate,
    verified: true,
  });
  applicantIds[person.fullName] = applicant.id;

  app.store.addCv({
    applicantId: applicant.id,
    label: person.cv.label,
    categories: person.cv.categories,
    headline: person.cv.headline,
    experienceYears: person.cv.experienceYears,
    educationLevel: person.cv.educationLevel,
    skills: person.cv.skills,
    languages: person.languages,
    certificates: person.cv.certificates,
    preferredSalaryTzs: person.cv.preferredSalaryTzs,
    filePath: null,
    isDefault: true,
  });

  app.store.savePreferences({
    applicantId: applicant.id,
    locations: [],
    categories: person.cv.categories,
    minSalaryTzs: null,
    maxSalaryTzs: null,
    certificateRequired: null,
    educationLevelMax: null,
    experienceYearsMax: null,
    accommodationRequiredOutsideHome: false,
    employmentTypes: [],
    workModes: [],
    willingToRelocate: person.willingToRelocate,
    genderNeutralOnly: false,
    immediateStartOnly: false,
  });

  const membership = app.memberships.purchase(applicant.id, person.packageCode);
  const pkg = app.store.getPackage(person.packageCode);
  app.memberships.confirmPayment(membership.id, pkg?.priceTzs ?? 0, `MPESA-${person.phone.slice(-6)}`);
  console.log(`Registered ${person.fullName} on the ${pkg?.name ?? person.packageCode} package`);
}

// Everyone swipes right on the top card their filters produced.
for (const [name, applicantId] of Object.entries(applicantIds)) {
  const cards = app.swipe.feed(applicantId, 5);
  for (const card of cards.slice(0, 2)) {
    const outcome = app.swipe.swipe(applicantId, card.vacancyId, 'right');
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
  const employerActor: Actor = { kind: 'employer', id: zanzibar.employerId };
  const applications = app.employer.applications(zanzibar.employerId, { vacancyId: zanzibar.vacancy.id });
  applications.forEach((entry, index) => {
    app.employer.openApplication(zanzibar.employerId, entry.application.id, employerActor);
    if (index === 0) {
      app.employer.shortlist(zanzibar.employerId, entry.application.id, employerActor, 'Strong resort experience');
      app.employer.inviteToInterview(
        zanzibar.employerId,
        entry.application.id,
        new Date(Date.now() + 3 * 86_400_000).toISOString(),
        employerActor,
        'Interview at the resort office',
      );
    }
  });

  const stats = app.store.vacancyStats(zanzibar.vacancy.id);
  console.log('\nZanzibar Resort dashboard:', stats);
  console.log(`Portal: ${zanzibar.portalUrl}`);
}

console.log('\nSoko Huru control dashboard');
for (const row of app.agency.overview()) {
  console.log(
    `  ${row.employerName.padEnd(24)} ${row.jobTitle.padEnd(26)} ${String(row.applications).padStart(3)} applications`,
  );
}

console.log('\nApplicant app tokens (hand these to the applicant with their account):');
for (const [name, applicantId] of Object.entries(applicantIds)) {
  const session = app.access.startApplicantSession(applicantId);
  console.log(`  ${name.padEnd(16)} ${applicantId}  ${session.token}`);
}

app.close();
