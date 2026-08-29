import type { TenantContext } from './app.ts';

export const DEMO_APPLICANT_PHONE = '+255700000999';

type DemoPoster = {
  employerName: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  text: string;
};

const DEMO_POSTERS: readonly DemoPoster[] = [
  {
    employerName: 'Zanzibar Pearl Resort (Demo)',
    contactName: 'Salma Khamis',
    contactPhone: '+255777100101',
    contactEmail: 'hr@zanzibarpearl.example',
    text: [
      'Job title: Hotel Attendant',
      'Company: Zanzibar Pearl Resort',
      'Location: Zanzibar',
      'Positions: 8',
      'Salary: TSh 520,000 per month plus tips',
      'Accommodation provided',
      'Languages: English and Swahili',
      'Requirements:',
      'Hospitality experience preferred',
      'Ready to start immediately',
    ].join('\n'),
  },
  {
    employerName: 'Serena City Hotel (Demo)',
    contactName: 'Grace Mushi',
    contactPhone: '+255777100102',
    contactEmail: 'people@serenacity.example',
    text: [
      'Job title: Front Desk Hotel Attendant',
      'Company: Serena City Hotel',
      'Location: Dar es Salaam',
      'Positions: 4',
      'Salary: TSh 650,000 per month',
      'Languages: English and Swahili',
      'Responsibilities:',
      'Welcome guests and handle check-in',
      'Answer reservation enquiries',
      'Requirements:',
      'Customer service experience preferred',
    ].join('\n'),
  },
  {
    employerName: 'Ocean Breeze Restaurant (Demo)',
    contactName: 'Abdul Hamis',
    contactPhone: '+255777100103',
    contactEmail: null,
    text: [
      'Job title: Waiter / Waitress',
      'Company: Ocean Breeze Restaurant',
      'Location: Dar es Salaam',
      'Positions: 10',
      'Salary: TSh 400,000 per month plus tips',
      'Responsibilities:',
      'Serve guests',
      'Take food and drink orders',
      'Requirements:',
      'Good customer service',
      'Immediate start',
    ].join('\n'),
  },
  {
    employerName: 'Kibo Call Centre (Demo)',
    contactName: 'Peter Mlay',
    contactPhone: '+255777100104',
    contactEmail: 'jobs@kibocall.example',
    text: [
      'Job title: Call Centre Agent',
      'Company: Kibo Call Centre',
      'Location: Dar es Salaam',
      'Positions: 12',
      'Salary: TSh 450,000 per month',
      'Languages: English and Swahili',
      'Responsibilities:',
      'Answer customer calls',
      'Log every complaint in the system',
      'Requirements:',
      'Form four and above',
      'Customer care experience preferred',
    ].join('\n'),
  },
  {
    employerName: 'City Logistics Tanzania (Demo)',
    contactName: 'John Massawe',
    contactPhone: '+255777100105',
    contactEmail: 'fleet@citylogistics.example',
    text: [
      'Job title: Truck Driver',
      'Company: City Logistics Tanzania',
      'Location: Dar es Salaam',
      'Positions: 6',
      'Salary: TSh 700,000 per month',
      'Experience: 3 years driving trucks',
      'Certificate required',
      'Requirements:',
      'Class C driving licence',
      'Ready to travel upcountry',
    ].join('\n'),
  },
  {
    employerName: 'Mwanga Private School (Demo)',
    contactName: 'Anna Mrema',
    contactPhone: '+255777100106',
    contactEmail: 'hr@mwangaschool.example',
    text: [
      'Job title: Secondary School Teacher',
      'Company: Mwanga Private School',
      'Location: Arusha',
      'Positions: 3',
      'Salary: TSh 800,000 per month',
      'Certificate required',
      'Requirements:',
      'Teaching certificate or degree',
      'English communication skills',
    ].join('\n'),
  },
  {
    employerName: 'Kariakoo Smart Shop (Demo)',
    contactName: 'Rehema Omari',
    contactPhone: '+255777100107',
    contactEmail: null,
    text: [
      'Job title: Shop Attendant',
      'Company: Kariakoo Smart Shop',
      'Location: Dar es Salaam',
      'Positions: 5',
      'Salary: TSh 500,000 per month',
      'Responsibilities:',
      'Help customers choose products',
      'Arrange shelves and stock',
      'Requirements:',
      'Good communication skills',
    ].join('\n'),
  },
  {
    employerName: 'Kobe Tech Hub (Demo)',
    contactName: 'David Macha',
    contactPhone: '+255777100108',
    contactEmail: 'careers@kobetechhub.example',
    text: [
      'Job title: IT Support Technician',
      'Company: Kobe Tech Hub',
      'Location: Dar es Salaam',
      'Positions: 2',
      'Salary: TSh 900,000 per month',
      'Certificate required',
      'Responsibilities:',
      'Support office computers and networks',
      'Troubleshoot user issues',
      'Requirements:',
      'IT support or network skills',
    ].join('\n'),
  },
];

export type DemoSeedResult = {
  createdJobs: number;
  demoJobs: number;
  applicantCreated: boolean;
  membershipActivated: boolean;
  applicantPhone: string;
  feedCards: number;
};

/**
 * Adds production-safe sample records without touching real agency records.
 * Every demo employer is clearly marked "(Demo)" and employer names are the
 * idempotency key, so redeploying never duplicates the deck.
 */
export async function ensureDemoData(context: TenantContext, staffId = 'demo-seed'): Promise<DemoSeedResult> {
  const existingEmployers = new Set(context.store.listEmployers().map((employer) => employer.name.toLowerCase()));
  let createdJobs = 0;

  for (const poster of DEMO_POSTERS) {
    if (existingEmployers.has(poster.employerName.toLowerCase())) continue;

    const { draft } = await context.intake.uploadPost({
      channel: 'pasted_text',
      text: poster.text,
      imagePath: null,
      employerName: poster.employerName,
      staffId,
    });

    context.intake.publishDraft(draft.id, {
      staffId,
      employerName: poster.employerName,
      contactName: poster.contactName,
      contactPhone: poster.contactPhone,
      contactEmail: poster.contactEmail,
    });

    existingEmployers.add(poster.employerName.toLowerCase());
    createdJobs += 1;
  }

  let applicant = context.store.getApplicantByPhone(DEMO_APPLICANT_PHONE);
  let applicantCreated = false;
  if (applicant === null) {
    applicant = context.applicants.register({
      fullName: 'Kazi Demo Applicant',
      phone: DEMO_APPLICANT_PHONE,
      email: 'demo@kazi.example',
      location: 'Dar es Salaam',
      educationLevel: 'certificate',
      experienceYears: 3,
      skills: ['Customer service', 'Computer skills', 'Driving', 'Hospitality'],
      languages: ['English', 'Swahili'],
      willingToRelocate: true,
      categories: [],
      preferredLocations: [],
      minSalaryTzs: null,
      certificateRequired: null,
    }).applicant;
    applicantCreated = true;
  }

  let membershipActivated = false;
  const membershipView = context.memberships.view(applicant.id);
  if (!membershipView.active) {
    if (membershipView.pendingPayment !== null) {
      context.memberships.confirmPayment(membershipView.pendingPayment.id, staffId);
      membershipActivated = true;
    } else {
      const plan = context.store.getPlan('certificate') ?? context.memberships.plans()[0] ?? null;
      if (plan !== null) {
        const { payment } = context.memberships.submitPayment({
          applicantId: applicant.id,
          planCode: plan.code,
          amountTzs: plan.priceTzs,
          reference: `DEMO-${new Date().toISOString().slice(0, 10)}-${applicant.id.slice(-8)}`,
          method: 'demo',
        });
        context.memberships.confirmPayment(payment.id, staffId);
        membershipActivated = true;
      }
    }
  }

  const demoEmployerNames = new Set(DEMO_POSTERS.map((poster) => poster.employerName.toLowerCase()));
  const demoJobs = context.agency
    .overview()
    .filter((row) => demoEmployerNames.has(row.employerName.toLowerCase())).length;

  return {
    createdJobs,
    demoJobs,
    applicantCreated,
    membershipActivated,
    applicantPhone: DEMO_APPLICANT_PHONE,
    feedCards: context.swipe.feed(applicant.id, 100).length,
  };
}
