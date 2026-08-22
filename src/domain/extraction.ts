import { REVIEW_THRESHOLD } from '../config.ts';
import { parseSalary } from './salary.ts';
import { cleanLine, hasAnyWord, hasWord, parseCount, titleCase, toLines } from './text.ts';
import type {
  ExtractedField,
  ExtractedJob,
  ExtractionResult,
  FieldConfidence,
  JobCategory,
  JobExtractor,
} from './types.ts';

/** How much we trust a value, by how it was found. */
const CONFIDENCE = {
  label: 0.95,
  pattern: 0.85,
  keyword: 0.75,
  inferred: 0.55,
  assumed: 0.4,
} as const;

/** A job cannot be published without these, so a gap is always flagged. */
const REQUIRED_FIELDS: readonly ExtractedField[] = ['title', 'location', 'category', 'positions', 'salary'];

const EMPTY_JOB: ExtractedJob = {
  title: null,
  employerName: null,
  location: null,
  category: null,
  positions: null,
  salary: null,
  description: null,
  responsibilities: [],
  requirements: [],
  applicationDeadline: null,
  contactInfo: null,
  accommodationProvided: null,
  languages: [],
  experienceNote: null,
  certificateRequired: null,
  immediateStart: null,
};

const LABELS: Partial<Record<ExtractedField, readonly string[]>> = {
  title: ['job title', 'position', 'post', 'job', 'role', 'vacancy', 'nafasi ya kazi', 'cheo', 'wadhifa'],
  employerName: ['company', 'employer', 'client', 'organisation', 'organization', 'kampuni', 'mwajiri'],
  location: ['location', 'place', 'area', 'duty station', 'station', 'eneo', 'mahali', 'sehemu', 'mkoa'],
  positions: ['positions', 'positions available', 'vacancies', 'slots', 'number required', 'idadi', 'nafasi'],
  salary: ['salary', 'wage', 'pay', 'payment', 'mshahara', 'malipo', 'ujira'],
  description: ['description', 'job description', 'about the role', 'maelezo'],
  applicationDeadline: ['deadline', 'closing date', 'apply before', 'mwisho', 'tarehe ya mwisho'],
  contactInfo: ['contact', 'contacts', 'apply to', 'send cv to', 'wasiliana', 'simu'],
  accommodationProvided: ['accommodation', 'housing', 'malazi'],
  languages: ['language', 'languages', 'lugha'],
  experienceNote: ['experience', 'work experience', 'uzoefu'],
  certificateRequired: ['certificate', 'certificates', 'cheti', 'vyeti'],
};

const CATEGORY_KEYWORDS: ReadonlyArray<{ category: JobCategory; keywords: readonly string[] }> = [
  {
    category: 'hospitality',
    keywords: ['hotel', 'attendant', 'attendants', 'waiter', 'waitress', 'chef', 'cook', 'housekeeping', 'housekeeper', 'bartender', 'barista', 'resort', 'lodge', 'restaurant', 'mhudumu', 'wahudumu', 'mpishi', 'hoteli'],
  },
  { category: 'driving', keywords: ['driver', 'drivers', 'rider', 'chauffeur', 'trailer', 'dereva', 'madereva'] },
  { category: 'teaching', keywords: ['teacher', 'teachers', 'tutor', 'lecturer', 'instructor', 'mwalimu', 'walimu'] },
  { category: 'healthcare', keywords: ['nurse', 'doctor', 'pharmacist', 'clinical', 'laboratory', 'muuguzi', 'daktari'] },
  { category: 'it', keywords: ['developer', 'programmer', 'software', 'it support', 'network', 'data analyst'] },
  { category: 'finance', keywords: ['accountant', 'accounts', 'finance', 'auditor', 'bookkeeper', 'mhasibu'] },
  { category: 'security', keywords: ['security', 'guard', 'watchman', 'askari', 'mlinzi', 'walinzi'] },
  { category: 'domestic', keywords: ['house help', 'housemaid', 'house girl', 'nanny', 'yaya', 'dada wa kazi'] },
  { category: 'construction', keywords: ['mason', 'carpenter', 'welder', 'plumber', 'electrician', 'fundi', 'ujenzi'] },
  { category: 'customer_care', keywords: ['call centre', 'call center', 'customer care', 'customer service', 'help desk', 'telesales', 'huduma kwa wateja'] },
  { category: 'retail', keywords: ['shop attendant', 'cashier', 'store keeper', 'storekeeper', 'duka'] },
  { category: 'sales', keywords: ['sales', 'marketing', 'sales representative', 'mauzo'] },
];

const KNOWN_LOCATIONS: readonly string[] = [
  'Zanzibar', 'Pemba', 'Unguja', 'Stone Town', 'Nungwi', 'Paje',
  'Dar es Salaam', 'Dodoma', 'Arusha', 'Mwanza', 'Mbeya', 'Morogoro', 'Tanga',
  'Moshi', 'Kilimanjaro', 'Iringa', 'Songea', 'Kigoma', 'Bagamoyo', 'Mtwara',
  'Tabora', 'Singida', 'Shinyanga', 'Musoma', 'Njombe', 'Sumbawanga', 'Lindi',
  'Babati', 'Kahama', 'Geita', 'Mafia', 'Bukoba',
];

const LANGUAGE_KEYWORDS: ReadonlyArray<{ language: string; keywords: readonly string[] }> = [
  { language: 'English', keywords: ['english', 'kiingereza'] },
  { language: 'Swahili', keywords: ['swahili', 'kiswahili'] },
  { language: 'French', keywords: ['french', 'kifaransa'] },
  { language: 'Arabic', keywords: ['arabic', 'kiarabu'] },
  { language: 'Italian', keywords: ['italian', 'kiitaliano'] },
  { language: 'Chinese', keywords: ['chinese', 'mandarin', 'kichina'] },
];

const RESPONSIBILITY_HEADERS = ['responsibilities', 'duties', 'job duties', 'key duties', 'majukumu', 'kazi zake'];
const REQUIREMENT_HEADERS = ['requirements', 'requirement', 'qualifications', 'qualification', 'sifa', 'vigezo', 'mahitaji'];
const CONTACT_HEADERS = ['contact', 'contacts', 'how to apply', 'apply', 'wasiliana', 'jinsi ya kutuma'];

const IMMEDIATE_WORDS = ['immediately', 'immediate', 'asap', 'at once', 'mara moja', 'haraka', 'sasa hivi'];
const NEGATIVE_WORDS = ['no', 'not', 'none', 'without', 'hakuna', 'hapana', 'haitolewi', 'haihitajiki', 'sio'];
const POSITIVE_WORDS = ['yes', 'provided', 'available', 'offered', 'free', 'included', 'required', 'ndiyo', 'ndio', 'inatolewa', 'yanatolewa', 'zinatolewa', 'inahitajika', 'lazima'];

const SWAHILI_MARKERS = ['nafasi', 'mshahara', 'uzoefu', 'miaka', 'kazi', 'tunahitaji', 'malazi', 'kwa', 'wanahitajika', 'elimu', 'eneo'];
const ENGLISH_MARKERS = ['salary', 'experience', 'required', 'location', 'position', 'accommodation', 'years', 'available', 'apply', 'start'];

/** Poster furniture that is never the job title. */
const BANNER_WORDS = ['ajira', 'exclusive', 'soko huru', 'vacancy announcement', 'nafasi za kazi', 'tangazo'];

const PHONE = /(?:\+?255|0)\s?\d{2,3}[\s-]?\d{3}[\s-]?\d{3,4}/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;

export function parseBooleanish(value: string): boolean | null {
  const text = value.toLowerCase();
  if (hasAnyWord(text, NEGATIVE_WORDS)) return false;
  if (hasAnyWord(text, POSITIVE_WORDS)) return true;
  return null;
}

function singularise(word: string): string {
  if (/ies$/i.test(word)) return word.replace(/ies$/i, 'y');
  if (/(sses|shes|ches|xes)$/i.test(word)) return word.replace(/es$/i, '');
  if (/ss$/i.test(word)) return word;
  if (/s$/i.test(word)) return word.replace(/s$/i, '');
  return word;
}

class Collector {
  job: ExtractedJob = { ...EMPTY_JOB, responsibilities: [], requirements: [], languages: [] };
  private readonly scores = new Map<ExtractedField, FieldConfidence>();

  set<K extends ExtractedField>(field: K, value: ExtractedJob[K], confidence: number, evidence: string | null): void {
    if (value === null || value === undefined) return;
    const existing = this.scores.get(field);
    if (existing && existing.confidence >= confidence) return;
    this.job[field] = value;
    this.scores.set(field, { field, confidence, evidence });
  }

  has(field: ExtractedField): boolean {
    return this.scores.has(field);
  }

  list(): FieldConfidence[] {
    return [...this.scores.values()].sort((a, b) => a.field.localeCompare(b.field));
  }
}

function matchLabel(line: string): { field: ExtractedField; value: string } | null {
  const separator = /^([^:：]{2,40})\s*[:：]\s*(.+)$/.exec(line);
  if (!separator) return null;
  const label = (separator[1] ?? '').trim().toLowerCase();
  const value = (separator[2] ?? '').trim();
  if (value.length === 0) return null;
  for (const [field, aliases] of Object.entries(LABELS) as [ExtractedField, readonly string[]][]) {
    if (aliases.some((alias) => label === alias || label.endsWith(` ${alias}`) || label.startsWith(`${alias} `))) {
      return { field, value };
    }
  }
  return null;
}

function headerOf(line: string): 'responsibilities' | 'requirements' | 'contact' | null {
  const text = line.toLowerCase().replace(/[:：\s]+$/, '').trim();
  if (text.length > 32) return null;
  if (RESPONSIBILITY_HEADERS.includes(text)) return 'responsibilities';
  if (REQUIREMENT_HEADERS.includes(text)) return 'requirements';
  if (CONTACT_HEADERS.includes(text)) return 'contact';
  return null;
}

function detectCategory(text: string): JobCategory | null {
  for (const entry of CATEGORY_KEYWORDS) {
    if (entry.keywords.some((keyword) => (keyword.includes(' ') ? text.includes(keyword) : hasWord(text, keyword)))) {
      return entry.category;
    }
  }
  return null;
}

function detectLanguages(text: string): string[] {
  const found: string[] = [];
  for (const entry of LANGUAGE_KEYWORDS) {
    if (entry.keywords.some((keyword) => text.includes(keyword))) found.push(entry.language);
  }
  return found;
}

/** "We require eight female hotel attendants" -> 8 positions, "Hotel Attendant". */
function parseRequirementSentence(text: string): { count: number | null; title: string | null } {
  const pattern =
    /\b(?:we\s+(?:require|need|are\s+looking\s+for|want|seek)|required|urgently\s+needed|wanted|tunahitaji|zinahitajika|wanahitajika|inahitajika)\b\s*[:\-]?\s*([^.!\n]+)/i;
  const match = pattern.exec(text);
  if (!match) return { count: null, title: null };

  const phrase = (match[1] ?? '').split(/\s+(?:to|for|in|at|kwa|katika)\s+/i)[0] ?? '';
  const stopWords = new Set([
    'a', 'an', 'the', 'our', 'urgent', 'urgently', 'qualified', 'experienced', 'smart', 'young',
    'energetic', 'hardworking', 'reliable', 'and', 'of', 'new', 'more',
    'female', 'females', 'male', 'males', 'women', 'men', 'ladies', 'wanawake', 'wanaume', 'kike', 'kiume',
  ]);

  let count: number | null = null;
  const titleWords: string[] = [];
  for (const rawWord of phrase.split(/\s+/)) {
    const word = rawWord.replace(/[^\p{L}\p{N}'-]/gu, '');
    if (word.length === 0) continue;
    const asCount = parseCount(word);
    if (asCount !== null && count === null) {
      count = asCount;
      continue;
    }
    if (stopWords.has(word.toLowerCase())) continue;
    titleWords.push(word);
  }
  if (titleWords.length === 0) return { count, title: null };

  const last = titleWords[titleWords.length - 1] ?? '';
  titleWords[titleWords.length - 1] = singularise(last);
  return { count, title: titleCase(titleWords.join(' ')) };
}

function parsePositions(text: string): { count: number; evidence: string } | null {
  const explicit =
    /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|moja|mbili|tatu|nne|tano|sita|saba|nane|tisa|kumi)\s+(?:positions?|posts?|vacancies|slots?|openings?|people|staff|nafasi)\b/i.exec(
      text,
    );
  if (explicit) {
    const count = parseCount(explicit[1] ?? '');
    if (count !== null) return { count, evidence: explicit[0] };
  }
  const swahili = /\bnafasi\s*[:\-]?\s*(\d+)\b/i.exec(text);
  if (swahili) {
    const count = parseCount(swahili[1] ?? '');
    if (count !== null) return { count, evidence: swahili[0] };
  }
  return null;
}

function detectCertificateRequirement(text: string): boolean | null {
  if (/\b(no certificate|without certificate|certificate not required|hakuna cheti|bila cheti)\b/i.test(text)) {
    return false;
  }
  if (
    /\b(certificate required|certificate is required|must have.{0,20}certificate|cheti kinahitajika|lazima uwe na cheti|certified|diploma|degree|bachelor|licence|license|leseni)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  return null;
}

function detectLanguage(text: string): 'en' | 'sw' | 'mixed' {
  const swahili = SWAHILI_MARKERS.filter((word) => hasWord(text, word)).length;
  const english = ENGLISH_MARKERS.filter((word) => hasWord(text, word)).length;
  if (swahili > 0 && english > 0 && Math.abs(swahili - english) <= 2) return 'mixed';
  return swahili > english ? 'sw' : 'en';
}

function isBanner(line: string): boolean {
  const lower = line.toLowerCase();
  return BANNER_WORDS.some((word) => lower.includes(word));
}

/**
 * The MVP Kobe AI extractor: deterministic, offline and auditable. Each value
 * carries the poster line it came from, so the review screen can show the
 * original poster beside the extracted fields.
 */
export class RuleBasedExtractor implements JobExtractor {
  readonly name = 'kobe-rules-v1';

  extract(rawText: string): ExtractionResult {
    const lines = toLines(rawText);
    const collector = new Collector();
    const lowerWhole = lines.join('\n').toLowerCase();

    const sections = this.readSections(lines);
    for (const line of lines) this.readLabelledLine(collector, line);
    this.readFreeform(collector, lines, lowerWhole, sections);
    this.applyDefaults(collector, lowerWhole);

    return {
      job: collector.job,
      confidence: collector.list(),
      needsReview: this.flagForReview(collector),
      extractor: this.name,
      detectedLanguage: detectLanguage(lowerWhole),
    };
  }

  /** Splits "Responsibilities:" / "Requirements:" / "Contact:" blocks out of the poster. */
  private readSections(lines: string[]): {
    responsibilities: string[];
    requirements: string[];
    contact: string[];
    body: string[];
  } {
    const sections = { responsibilities: [] as string[], requirements: [] as string[], contact: [] as string[], body: [] as string[] };
    let current: 'responsibilities' | 'requirements' | 'contact' | null = null;

    for (const line of lines) {
      const header = headerOf(line);
      if (header !== null) {
        current = header;
        continue;
      }
      // A labelled line ends any open section: "Salary: ..." is not a duty.
      if (matchLabel(line) !== null) {
        current = null;
        sections.body.push(line);
        continue;
      }
      if (current === null) sections.body.push(line);
      else sections[current].push(line);
    }
    return sections;
  }

  private readLabelledLine(collector: Collector, line: string): void {
    const labelled = matchLabel(line);
    if (!labelled) return;
    const { field, value } = labelled;
    const lower = value.toLowerCase();

    switch (field) {
      case 'title':
        collector.set('title', titleCase(value), CONFIDENCE.label, line);
        break;
      case 'employerName':
        collector.set('employerName', value, CONFIDENCE.label, line);
        break;
      case 'location':
        collector.set('location', value, CONFIDENCE.label, line);
        break;
      case 'positions': {
        const count = parseCount(value.split(/\s+/)[0] ?? '') ?? parsePositions(value)?.count ?? null;
        collector.set('positions', count, CONFIDENCE.label, line);
        break;
      }
      case 'salary':
        collector.set('salary', parseSalary(`salary ${value}`), CONFIDENCE.label, line);
        break;
      case 'description':
        collector.set('description', value, CONFIDENCE.label, line);
        break;
      case 'applicationDeadline':
        collector.set('applicationDeadline', value, CONFIDENCE.label, line);
        break;
      case 'contactInfo':
        collector.set('contactInfo', value, CONFIDENCE.label, line);
        break;
      case 'accommodationProvided':
        collector.set('accommodationProvided', parseBooleanish(value) ?? true, CONFIDENCE.label, line);
        break;
      case 'languages': {
        const languages = detectLanguages(lower);
        if (languages.length > 0) collector.set('languages', languages, CONFIDENCE.label, line);
        break;
      }
      case 'experienceNote':
        collector.set('experienceNote', value, CONFIDENCE.label, line);
        break;
      case 'certificateRequired':
        collector.set('certificateRequired', parseBooleanish(value) ?? true, CONFIDENCE.label, line);
        break;
      default:
        break;
    }
  }

  private readFreeform(
    collector: Collector,
    lines: string[],
    lowerWhole: string,
    sections: { responsibilities: string[]; requirements: string[]; contact: string[]; body: string[] },
  ): void {
    const requirement = parseRequirementSentence(lowerWhole);
    if (requirement.count !== null) collector.set('positions', requirement.count, CONFIDENCE.pattern, 'requirement sentence');
    if (requirement.title !== null) collector.set('title', requirement.title, CONFIDENCE.pattern, 'requirement sentence');

    const positions = parsePositions(lowerWhole);
    if (positions) collector.set('positions', positions.count, CONFIDENCE.pattern, positions.evidence);

    if (!collector.has('salary')) {
      for (const line of lines) {
        const salary = parseSalary(line);
        if (salary) {
          collector.set('salary', salary, CONFIDENCE.pattern, line);
          break;
        }
      }
    }

    if (!collector.has('location')) {
      const hit = KNOWN_LOCATIONS.find((place) => lowerWhole.includes(place.toLowerCase()));
      if (hit) collector.set('location', hit, CONFIDENCE.keyword, `matched place name "${hit}"`);
    }

    if (sections.responsibilities.length > 0) {
      collector.set('responsibilities', sections.responsibilities, CONFIDENCE.label, 'responsibilities section');
    }

    // Requirements come from an explicit section plus the requirement-shaped
    // lines the poster scatters around ("English required", "Age 18-35").
    const requirements = [...sections.requirements];
    for (const line of sections.body) {
      const lower = line.toLowerCase();
      if (isBanner(line)) continue;
      if (
        /\b(required|must|lazima|inahitajika|preferred|experience|uzoefu|age|umri|miaka|certificate|cheti|licence|license|leseni|female|male|wanawake|wanaume)\b/i.test(
          lower,
        ) &&
        matchLabel(line) === null
      ) {
        requirements.push(line);
      }
    }
    if (requirements.length > 0) {
      collector.set('requirements', [...new Set(requirements)], CONFIDENCE.pattern, 'requirement lines');
    }

    const contactLines = [...sections.contact, ...lines.filter((line) => PHONE.test(line) || EMAIL.test(line))];
    if (contactLines.length > 0) {
      collector.set('contactInfo', [...new Set(contactLines)].join(' · '), CONFIDENCE.pattern, contactLines[0] ?? null);
    }

    // Whatever prose is left over becomes the description shown on the detail page.
    const description = sections.body
      .filter((line) => !isBanner(line) && matchLabel(line) === null && !requirements.includes(line))
      .filter((line) => line.split(/\s+/).length >= 4);
    if (description.length > 0) {
      collector.set('description', description.join('\n'), CONFIDENCE.inferred, 'remaining poster text');
    }

    for (const line of lines) {
      const lower = line.toLowerCase();
      if (hasAnyWord(lower, ['accommodation', 'housing', 'malazi'])) {
        collector.set('accommodationProvided', parseBooleanish(lower) ?? true, CONFIDENCE.keyword, line);
      }
      if (hasAnyWord(lower, ['experience', 'uzoefu'])) {
        collector.set('experienceNote', line, CONFIDENCE.keyword, line);
      }
      if (hasAnyWord(lower, IMMEDIATE_WORDS)) {
        collector.set('immediateStart', true, CONFIDENCE.pattern, line);
      }
    }

    const languages = detectLanguages(lowerWhole);
    if (languages.length > 0) collector.set('languages', languages, CONFIDENCE.keyword, 'language keywords');

    const certificate = detectCertificateRequirement(lowerWhole);
    if (certificate !== null) collector.set('certificateRequired', certificate, CONFIDENCE.pattern, 'certificate wording');

    const category = detectCategory((collector.job.title ?? '').toLowerCase()) ?? detectCategory(lowerWhole);
    if (category) {
      collector.set('category', category, collector.job.title ? CONFIDENCE.keyword : CONFIDENCE.inferred, 'category keywords');
    }
  }

  private applyDefaults(collector: Collector, lowerWhole: string): void {
    collector.set('category', 'other', CONFIDENCE.assumed, 'default');
    collector.set('positions', 1, CONFIDENCE.assumed, 'default: one position');
    collector.set('accommodationProvided', false, CONFIDENCE.assumed, 'default');
    collector.set('certificateRequired', false, CONFIDENCE.assumed, 'default: no certificate needed');
    collector.set('immediateStart', hasAnyWord(lowerWhole, IMMEDIATE_WORDS), CONFIDENCE.assumed, 'default');
  }

  private flagForReview(collector: Collector): ExtractedField[] {
    const flagged = new Set<ExtractedField>();
    for (const field of REQUIRED_FIELDS) {
      if (collector.job[field] === null) flagged.add(field);
    }
    for (const entry of collector.list()) {
      if (entry.confidence < REVIEW_THRESHOLD) flagged.add(entry.field);
    }
    return [...flagged].sort();
  }
}

/**
 * Wraps any text-completion function as an extractor so a hosted model can be
 * dropped in later without touching intake. It never overrides a value the
 * poster stated on a labelled line, and a model failure falls back to the
 * rule-based reading rather than blocking the agency from publishing.
 */
export class AssistedExtractor implements JobExtractor {
  readonly name: string;
  private readonly complete: (prompt: string) => Promise<string>;
  private readonly fallback = new RuleBasedExtractor();

  constructor(complete: (prompt: string) => Promise<string>, name = 'kobe-assisted-v1') {
    this.complete = complete;
    this.name = name;
  }

  async extract(rawText: string): Promise<ExtractionResult> {
    const base = this.fallback.extract(rawText);
    let parsed: Partial<ExtractedJob> | null = null;
    try {
      parsed = JSON.parse(await this.complete(buildExtractionPrompt(rawText))) as Partial<ExtractedJob>;
    } catch {
      return base;
    }

    const merged: ExtractedJob = { ...base.job };
    const confidence = new Map(base.confidence.map((entry) => [entry.field, entry]));
    for (const [key, value] of Object.entries(parsed) as [ExtractedField, unknown][]) {
      if (value === null || value === undefined || !(key in merged)) continue;
      if ((confidence.get(key)?.confidence ?? 0) >= CONFIDENCE.label) continue;
      (merged as Record<string, unknown>)[key] = value;
      confidence.set(key, { field: key, confidence: CONFIDENCE.pattern, evidence: `${this.name} extraction` });
    }

    const needsReview = [...confidence.values()]
      .filter((entry) => entry.confidence < REVIEW_THRESHOLD)
      .map((entry) => entry.field);
    for (const field of REQUIRED_FIELDS) {
      if (merged[field] === null) needsReview.push(field);
    }

    return {
      job: merged,
      confidence: [...confidence.values()].sort((a, b) => a.field.localeCompare(b.field)),
      needsReview: [...new Set(needsReview)].sort(),
      extractor: this.name,
      detectedLanguage: base.detectedLanguage,
    };
  }
}

export function buildExtractionPrompt(rawText: string): string {
  return [
    'Extract the vacancy details from this Tanzanian recruitment post.',
    'The post may be in English, Swahili or both.',
    'Reply with JSON only, using these keys:',
    Object.keys(EMPTY_JOB).join(', '),
    'Use null for anything the post does not state. Do not invent details.',
    '',
    'POST:',
    cleanLine(rawText),
  ].join('\n');
}
