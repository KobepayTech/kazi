import { evaluateJobFit } from './matching.ts';
import type { JobFit } from './matching.ts';
import type { Applicant, ApplicantPreferences, Cv, Job } from './types.ts';

export type ApplicationLanguage = 'en' | 'sw';

export type InterviewPrep = {
  focusAreas: string[];
  likelyQuestions: string[];
  starPrompts: string[];
  questionsToAsk: string[];
  truthReminder: string;
};

export type ApplicationPackage = {
  generatedAt: string;
  applicantId: string;
  jobId: string;
  employerName: string;
  language: ApplicationLanguage;
  fit: JobFit;
  tailoredCvText: string;
  coverLetterText: string;
  interviewPrep: InterviewPrep;
};

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ').trim();
}

function phraseAppears(phrase: string, haystack: string): boolean {
  const needle = normalise(phrase);
  if (needle.length < 2) return false;
  if (haystack.includes(needle)) return true;
  const words = needle.split(' ').filter((word) => word.length >= 3);
  return words.length > 0 && words.every((word) => haystack.includes(word));
}

function vacancyText(job: Job): string {
  return [
    job.title,
    job.description ?? '',
    ...job.requirements,
    ...job.responsibilities,
    job.experienceNote ?? '',
    job.sourceText ?? '',
  ].join(' ');
}

function detectLanguage(job: Job): ApplicationLanguage {
  const text = normalise(vacancyText(job));
  const swahili = ['nafasi', 'kazi', 'uzoefu', 'mshahara', 'elimu', 'sifa', 'maombi', 'mwombaji', 'anahitajika', 'majukumu'];
  const english = ['position', 'job', 'experience', 'salary', 'education', 'requirements', 'apply', 'applicant', 'responsibilities'];
  const sw = swahili.filter((word) => text.includes(word)).length;
  const en = english.filter((word) => text.includes(word)).length;
  return sw >= 2 && sw > en ? 'sw' : 'en';
}

function relevantSkills(cv: Cv, job: Job): { matched: string[]; other: string[] } {
  const text = normalise(vacancyText(job));
  const matched = cv.skills.filter((skill) => phraseAppears(skill, text));
  const matchedSet = new Set(matched);
  return {
    matched,
    other: cv.skills.filter((skill) => !matchedSet.has(skill)),
  };
}

function experienceLine(cv: Cv, language: ApplicationLanguage): string {
  if (language === 'sw') {
    return cv.experienceYears > 0
      ? `Uzoefu uliowekwa kwenye wasifu: miaka ${cv.experienceYears}.`
      : 'Wasifu haujaweka miaka ya uzoefu wa kazi.';
  }
  return cv.experienceYears > 0
    ? `Experience stated on profile: ${cv.experienceYears} year(s).`
    : 'No years of work experience are stated on the profile.';
}

function buildTailoredCv(
  applicant: Applicant,
  cv: Cv,
  job: Job,
  employerName: string,
  fit: JobFit,
  language: ApplicationLanguage,
): string {
  const skills = relevantSkills(cv, job);
  const orderedSkills = [...skills.matched, ...skills.other];
  const lines: string[] = [
    cv.fullName.toUpperCase(),
    language === 'sw' ? `Mwombaji — ${job.title}` : `Candidate — ${job.title}`,
    '',
    `${language === 'sw' ? 'Mahali' : 'Location'}: ${cv.location}`,
    `${language === 'sw' ? 'Simu' : 'Phone'}: ${cv.phone}`,
  ];
  if (cv.email !== null) lines.push(`Email: ${cv.email}`);

  lines.push(
    '',
    language === 'sw' ? 'MUHTASARI ULIOELEKEZWA KWENYE NAFASI' : 'ROLE-FOCUSED PROFILE',
    language === 'sw'
      ? `Wasifu huu umeandaliwa kwa nafasi ya ${job.title} katika ${employerName}. Taarifa zote hapa zinatokana na wasifu wa mwombaji; hakuna uzoefu au mafanikio yaliyobuniwa.`
      : `This CV is tailored for the ${job.title} role at ${employerName}. Every statement comes from the applicant profile; no experience or achievements are invented.`,
  );

  if (fit.strengths.length > 0) {
    lines.push(
      '',
      language === 'sw' ? 'YANAYOLINGANA NA NAFASI' : 'RELEVANT MATCH',
      ...fit.strengths.map((item) => `- ${item}`),
    );
  }

  lines.push(
    '',
    language === 'sw' ? 'UZOEFU' : 'EXPERIENCE',
    experienceLine(cv, language),
    '',
    language === 'sw' ? 'ELIMU' : 'EDUCATION',
    cv.educationLevel,
  );

  if (orderedSkills.length > 0) {
    lines.push(
      '',
      language === 'sw' ? 'UJUZI' : 'SKILLS',
      ...orderedSkills.map((skill) => `- ${skill}${skills.matched.includes(skill) ? (language === 'sw' ? ' (unalingana na tangazo)' : ' (matched to vacancy)') : ''}`),
    );
  }

  if (cv.languages.length > 0) {
    lines.push('', language === 'sw' ? 'LUGHA' : 'LANGUAGES', ...cv.languages.map((item) => `- ${item}`));
  }

  if (cv.certificates.length > 0) {
    lines.push('', language === 'sw' ? 'VYETI' : 'CERTIFICATES', ...cv.certificates.map((entry) => `- ${entry.label}`));
  }

  lines.push(
    '',
    language === 'sw' ? 'UPATIKANAJI' : 'AVAILABILITY',
    applicant.willingToRelocate
      ? (language === 'sw' ? 'Yuko tayari kuhamia eneo la kazi.' : 'Willing to relocate for work.')
      : (language === 'sw' ? `Anapendelea kazi karibu na ${applicant.location}.` : `Prefers work near ${applicant.location}.`),
  );

  return lines.join('\n');
}

function buildCoverLetter(
  applicant: Applicant,
  cv: Cv,
  job: Job,
  employerName: string,
  language: ApplicationLanguage,
): string {
  const { matched } = relevantSkills(cv, job);
  const requirement = job.requirements[0] ?? null;

  if (language === 'sw') {
    const lines = [
      'Ndugu Timu ya Ajira,',
      '',
      `Ninaomba nafasi ya ${job.title} katika ${employerName}, ${job.location}.`,
    ];
    if (cv.experienceYears > 0) lines.push(`Wasifu wangu unaonyesha nina miaka ${cv.experienceYears} ya uzoefu wa kazi.`);
    if (matched.length > 0) lines.push(`Ujuzi wangu unaolingana moja kwa moja na tangazo hili ni pamoja na ${matched.slice(0, 4).join(', ')}.`);
    lines.push(`Kiwango changu cha elimu kilichowekwa kwenye wasifu ni ${cv.educationLevel}.`);
    if (cv.languages.length > 0) lines.push(`Lugha nilizoweka kwenye wasifu ni ${cv.languages.join(', ')}.`);
    if (requirement !== null) lines.push(`Tangazo limetaja hitaji hili: "${requirement}". Ningependa kueleza kwa undani jinsi uzoefu wangu halisi unavyohusiana nalo wakati wa mahojiano.`);
    lines.push(
      applicant.willingToRelocate
        ? 'Niko tayari kuhamia eneo la kazi ikiwa nafasi itahitaji.'
        : `Ninaishi ${applicant.location} na napendelea kazi inayolingana na mpangilio huo.`,
      '',
      'Asante kwa kuzingatia maombi yangu. Niko tayari kutoa maelezo zaidi au kuhudhuria mahojiano.',
      '',
      `Wako,\n${cv.fullName}`,
    );
    return lines.join('\n');
  }

  const lines = [
    'Dear Hiring Team,',
    '',
    `I am applying for the ${job.title} position with ${employerName} in ${job.location}.`,
  ];
  if (cv.experienceYears > 0) lines.push(`My profile records ${cv.experienceYears} year(s) of work experience.`);
  if (matched.length > 0) lines.push(`Skills on my profile that directly match this vacancy include ${matched.slice(0, 4).join(', ')}.`);
  lines.push(`My stated education level is ${cv.educationLevel}.`);
  if (cv.languages.length > 0) lines.push(`The languages listed on my profile are ${cv.languages.join(', ')}.`);
  if (requirement !== null) lines.push(`The vacancy lists this requirement: "${requirement}". I would be glad to explain how my actual experience relates to it during an interview.`);
  lines.push(
    applicant.willingToRelocate
      ? 'I am willing to relocate if the role requires it.'
      : `I am based in ${applicant.location} and prefer work compatible with that location.`,
    '',
    'Thank you for considering my application. I am available to provide more information or attend an interview.',
    '',
    `Sincerely,\n${cv.fullName}`,
  );
  return lines.join('\n');
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function buildInterviewPrep(cv: Cv, job: Job, fit: JobFit, language: ApplicationLanguage): InterviewPrep {
  const { matched } = relevantSkills(cv, job);
  if (language === 'sw') {
    const focusAreas = unique([
      ...matched.slice(0, 4),
      ...job.responsibilities.slice(0, 3),
      ...fit.gaps.slice(0, 2),
    ]);
    const likelyQuestions = unique([
      `Tuambie kuhusu uzoefu wako unaohusiana na nafasi ya ${job.title}.`,
      ...job.responsibilities.slice(0, 3).map((item) => `Umeshughulikiaje kazi inayofanana na: ${item}?`),
      ...job.requirements.slice(0, 2).map((item) => `Je, unaweza kueleza uzoefu wako halisi kuhusu hitaji hili: ${item}?`),
      'Kwa nini nafasi hii inakuvutia?',
    ]);
    const starPrompts = unique([
      ...matched.slice(0, 3).map((skill) => `Andaa mfano wa Hali-Kazi-Hatua-Matokeo unaoonyesha ulipotumia ${skill}. Tumia tukio ulilofanya kweli.`),
      ...job.responsibilities.slice(0, 2).map((item) => `Andaa mfano halisi wa Hali-Kazi-Hatua-Matokeo unaohusiana na jukumu hili: ${item}.`),
    ]);
    return {
      focusAreas,
      likelyQuestions,
      starPrompts,
      questionsToAsk: [
        'Matarajio makuu kwa mtu atakayeanza nafasi hii katika siku 30 za kwanza ni yapi?',
        'Ratiba ya kawaida na mfumo wa kazi ukoje?',
        'Mnapimaje mafanikio katika nafasi hii?',
        'Hatua inayofuata katika mchakato wa ajira ni ipi?',
      ],
      truthReminder: 'Usibuni uzoefu, cheo, ujuzi au mafanikio. Tumia mifano ambayo umefanya kweli; kama huna mfano, sema hivyo na eleza jinsi ungejifunza.',
    };
  }

  const focusAreas = unique([
    ...matched.slice(0, 4),
    ...job.responsibilities.slice(0, 3),
    ...fit.gaps.slice(0, 2),
  ]);
  const likelyQuestions = unique([
    `Tell us about your experience relevant to the ${job.title} role.`,
    ...job.responsibilities.slice(0, 3).map((item) => `How have you handled work similar to: ${item}?`),
    ...job.requirements.slice(0, 2).map((item) => `Can you describe your actual experience with this requirement: ${item}?`),
    'Why are you interested in this role?',
  ]);
  const starPrompts = unique([
    ...matched.slice(0, 3).map((skill) => `Prepare a Situation-Task-Action-Result example showing when you used ${skill}. Use only something you actually did.`),
    ...job.responsibilities.slice(0, 2).map((item) => `Prepare a truthful Situation-Task-Action-Result example related to this responsibility: ${item}.`),
  ]);
  return {
    focusAreas,
    likelyQuestions,
    starPrompts,
    questionsToAsk: [
      'What are the main priorities for the person starting this role in the first 30 days?',
      'What does the normal schedule and working arrangement look like?',
      'How do you measure success in this role?',
      'What is the next step in the hiring process?',
    ],
    truthReminder: 'Do not invent experience, titles, skills or achievements. Use examples you actually lived; if you do not have one, say so and explain how you would learn.',
  };
}

/**
 * Adapts the useful application workflow from MadsLorentzen/ai-job-search to
 * Kazi's structured applicant/job model: evaluate first, tailor without
 * inventing facts, draft the letter, then prepare for interview.
 */
export function buildApplicationPackage(input: {
  applicant: Applicant;
  cv: Cv;
  job: Job;
  employerName: string;
  preferences?: ApplicantPreferences | null;
}): ApplicationPackage {
  const language = detectLanguage(input.job);
  const fit = evaluateJobFit(input.applicant, input.job, input.preferences ?? null);
  return {
    generatedAt: new Date().toISOString(),
    applicantId: input.applicant.id,
    jobId: input.job.id,
    employerName: input.employerName,
    language,
    fit,
    tailoredCvText: buildTailoredCv(input.applicant, input.cv, input.job, input.employerName, fit, language),
    coverLetterText: buildCoverLetter(input.applicant, input.cv, input.job, input.employerName, language),
    interviewPrep: buildInterviewPrep(input.cv, input.job, fit, language),
  };
}
