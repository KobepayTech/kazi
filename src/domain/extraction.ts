import { REVIEW_THRESHOLD } from '../config.ts';
import { parseSalary } from './salary.ts';
import { cleanLine, hasAnyWord, hasWord, parseCount, titleCase, toLines } from './text.ts';
import type {
  EducationLevel,
  EmploymentType,
  ExtractedVacancy,
  ExtractionResult,
  FieldConfidence,
  GenderRequirement,
  JobCategory,
  VacancyExtractor,
  WorkMode,
} from './types.ts';

type Field = keyof ExtractedVacancy;

/** How much we trust a value, by how it was found. */
const CONFIDENCE = {
  label: 0.95,
  pattern: 0.85,
  keyword: 0.75,
  inferred: 0.55,
  assumed: 0.4,
} as const;

/** Without these a card cannot be published, so a missing one is always flagged. */
const REQUIRED_FIELDS: readonly Field[] = ['title', 'location', 'category', 'positions', 'salary'];

const EMPTY_VACANCY: ExtractedVacancy = {
  title: null,
  employerName: null,
  location: null,
  category: null,
  positions: null,
  salary: null,
  accommodationProvided: null,
  mealsProvided: null,
  transportProvided: null,
  employmentType: null,
  workMode: null,
  genderRequirement: null,
  ageMin: null,
  ageMax: null,
  languages: [],
  experienceYearsMin: null,
  experienceNote: null,
  educationMin: null,
  certificateRequired: null,
  immediateStart: null,
  startDate: null,
  applicationDeadline: null,
};

const LABELS: Partial<Record<Field, readonly string[]>> = {
  title: ['job title', 'position', 'post', 'job', 'role', 'vacancy', 'nafasi ya kazi', 'cheo', 'wadhifa'],
  employerName: ['company', 'employer', 'client', 'organisation', 'organization', 'kampuni', 'mwajiri'],
  location: ['location', 'place', 'area', 'duty station', 'station', 'eneo', 'mahali', 'sehemu', 'mkoa'],
  positions: ['positions', 'position available', 'positions available', 'vacancies', 'slots', 'number required', 'idadi', 'nafasi'],
  salary: ['salary', 'wage', 'pay', 'payment', 'mshahara', 'malipo', 'ujira'],
  accommodationProvided: ['accommodation', 'housing', 'malazi'],
  mealsProvided: ['meals', 'food', 'chakula'],
  transportProvided: ['transport', 'usafiri'],
  employmentType: ['employment type', 'job type', 'type of employment', 'aina ya kazi'],
  workMode: ['work mode', 'working mode', 'mode of work'],
  genderRequirement: ['gender', 'sex', 'jinsia', 'gender requirement'],
  ageMin: ['age', 'age limit', 'umri'],
  languages: ['language', 'languages', 'lugha'],
  experienceYearsMin: ['experience', 'work experience', 'uzoefu'],
  educationMin: ['education', 'qualification', 'qualifications', 'elimu', 'sifa'],
  certificateRequired: ['certificate', 'certificates', 'cheti', 'vyeti'],
  startDate: ['start date', 'starting date', 'commencement', 'kuanza', 'tarehe ya kuanza'],
  applicationDeadline: ['deadline', 'closing date', 'apply before', 'mwisho', 'tarehe ya mwisho'],
};

const CATEGORY_KEYWORDS: ReadonlyArray<{ category: JobCategory; keywords: readonly string[] }> = [
  {
    category: 'hospitality',
    keywords: ['hotel', 'attendant', 'attendants', 'waiter', 'waitress', 'chef', 'cook', 'housekeeping', 'housekeeper', 'bartender', 'barista', 'resort', 'lodge', 'restaurant', 'mhudumu', 'wahudumu', 'mpishi', 'hoteli'],
  },
  { category: 'driving', keywords: ['driver', 'drivers', 'rider', 'chauffeur', 'trailer', 'dereva', 'madereva'] },
  { category: 'teaching', keywords: ['teacher', 'teachers', 'tutor', 'lecturer', 'instructor', 'mwalimu', 'walimu'] },
  { category: 'healthcare', keywords: ['nurse', 'doctor', 'pharmacist', 'clinical', 'laboratory', 'muuguzi', 'daktari'] },
  { category: 'it', keywords: ['developer', 'programmer', 'software', 'it support', 'network', 'data analyst', 'technician it'] },
  { category: 'finance', keywords: ['accountant', 'accounts', 'finance', 'auditor', 'bookkeeper', 'mhasibu'] },
  { category: 'security', keywords: ['security', 'guard', 'watchman', 'askari', 'mlinzi', 'walinzi'] },
  { category: 'domestic', keywords: ['house help', 'housemaid', 'house girl', 'nanny', 'yaya', 'dada wa kazi'] },
  { category: 'construction', keywords: ['mason', 'carpenter', 'welder', 'plumber', 'electrician', 'fundi', 'ujenzi'] },
  { category: 'customer_care', keywords: ['call centre', 'call center', 'customer care', 'customer service', 'help desk', 'telesales', 'huduma kwa wateja'] },
  { category: 'retail', keywords: ['shop attendant', 'cashier', 'store keeper', 'storekeeper', 'duka', 'muuzaji duka'] },
  { category: 'sales', keywords: ['sales', 'marketing', 'sales representative', 'mauzo'] },
];

const KNOWN_LOCATIONS: readonly string[] = [
  'Zanzibar', 'Pemba', 'Unguja', 'Stone Town', 'Nungwi', 'Paje',
  'Dar es Salaam', 'Dodoma', 'Arusha', 'Mwanza', 'Mbeya', 'Morogoro', 'Tanga',
  'Moshi', 'Kilimanjaro', 'Iringa', 'Songea', 'Kigoma', 'Bagamoyo', 'Mtwara',
  'Tabora', 'Singida', 'Shinyanga', 'Musoma', 'Njombe', 'Sumbawanga', 'Lindi',
  'Babati', 'Kahama', 'Geita', 'Mafia', 'Bukoba', 'Nairobi', 'Mombasa', 'Kampala',
];

const LANGUAGE_KEYWORDS: ReadonlyArray<{ language: string; keywords: readonly string[] }> = [
  { language: 'English', keywords: ['english', 'kiingereza'] },
  { language: 'Swahili', keywords: ['swahili', 'kiswahili'] },
  { language: 'French', keywords: ['french', 'kifaransa'] },
  { language: 'Arabic', keywords: ['arabic', 'kiarabu'] },
  { language: 'Italian', keywords: ['italian', 'kiitaliano'] },
  { language: 'Chinese', keywords: ['chinese', 'mandarin', 'kichina'] },
];

const EDUCATION_KEYWORDS: ReadonlyArray<{ level: EducationLevel; keywords: readonly string[] }> = [
  { level: 'postgraduate', keywords: ['masters', "master's", 'msc', 'mba', 'postgraduate', 'phd'] },
  { level: 'degree', keywords: ['degree', 'bachelor', 'bsc', 'ba ', 'shahada'] },
  { level: 'diploma', keywords: ['diploma', 'stashahada'] },
  { level: 'certificate', keywords: ['certificate', 'cheti', 'vyeti'] },
  { level: 'secondary', keywords: ['form four', 'form 4', 'form six', 'form 6', 'o level', 'a level', 'secondary', 'kidato cha nne', 'kidato cha sita', 'sekondari'] },
  { level: 'primary', keywords: ['primary', 'standard seven', 'darasa la saba', 'msingi'] },
];

const EMPLOYMENT_TYPE_KEYWORDS: ReadonlyArray<{ type: EmploymentType; keywords: readonly string[] }> = [
  { type: 'internship', keywords: ['internship', 'intern', 'mafunzo kwa vitendo'] },
  { type: 'part_time', keywords: ['part time', 'part-time', 'muda maalum'] },
  { type: 'contract', keywords: ['contract', 'mkataba'] },
  { type: 'casual', keywords: ['casual', 'vibarua', 'kibarua'] },
  { type: 'full_time', keywords: ['full time', 'full-time', 'permanent', 'muda wote', 'ajira ya kudumu'] },
];

const FEMALE_WORDS = ['female', 'females', 'women', 'woman', 'ladies', 'lady', 'wanawake', 'kike', 'mabinti', 'wasichana'];
const MALE_WORDS = ['male', 'males', 'men', 'man', 'gentlemen', 'wanaume', 'kiume', 'vijana wa kiume'];

const IMMEDIATE_WORDS = ['immediately', 'immediate', 'asap', 'at once', 'mara moja', 'haraka', 'sasa hivi'];

const NEGATIVE_WORDS = ['no', 'not', 'none', 'without', 'hakuna', 'hapana', 'haitolewi', 'haihitajiki', 'sio'];
const POSITIVE_WORDS = ['yes', 'provided', 'available', 'offered', 'free', 'included', 'required', 'ndiyo', 'ndio', 'inatolewa', 'yanatolewa', 'zinatolewa', 'inahitajika', 'lazima'];

const SWAHILI_MARKERS = ['nafasi', 'mshahara', 'uzoefu', 'miaka', 'kazi', 'tunahitaji', 'malazi', 'kwa', 'wanahitajika', 'elimu', 'eneo'];
const ENGLISH_MARKERS = ['salary', 'experience', 'required', 'location', 'position', 'accommodation', 'years', 'available', 'apply', 'start'];

/** Reads "provided" / "hakuna" / "not required" into a boolean. Negatives win. */
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
  vacancy: ExtractedVacancy = { ...EMPTY_VACANCY, languages: [] };
  private readonly scores = new Map<Field, FieldConfidence>();

  /** Keeps the highest-confidence value seen for a field. */
  set<K extends Field>(field: K, value: ExtractedVacancy[K], confidence: number, evidence: string | null): void {
    if (value === null || value === undefined) return;
    const existing = this.scores.get(field);
    if (existing && existing.confidence >= confidence) return;
    this.vacancy[field] = value;
    this.scores.set(field, { field, confidence, evidence });
  }

  has(field: Field): boolean {
    return this.scores.has(field);
  }

  confidenceOf(field: Field): number {
    return this.scores.get(field)?.confidence ?? 0;
  }

  list(): FieldConfidence[] {
    return [...this.scores.values()].sort((a, b) => a.field.localeCompare(b.field));
  }
}

function matchLabel(line: string): { field: Field; value: string } | null {
  const separator = /^([^:•\-–]{2,40})\s*[:：]\s*(.+)$/.exec(line);
  if (!separator) return null;
  const label = (separator[1] ?? '').trim().toLowerCase();
  const value = (separator[2] ?? '').trim();
  if (value.length === 0) return null;
  for (const [field, aliases] of Object.entries(LABELS) as [Field, readonly string[]][]) {
    if (aliases.some((alias) => label === alias || label.endsWith(` ${alias}`) || label.startsWith(`${alias} `))) {
      return { field, value };
    }
  }
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

function detectGender(text: string): GenderRequirement | null {
  if (hasAnyWord(text, FEMALE_WORDS)) return 'female';
  if (hasAnyWord(text, MALE_WORDS)) return 'male';
  return null;
}

function detectLanguages(text: string): string[] {
  const found: string[] = [];
  for (const entry of LANGUAGE_KEYWORDS) {
    if (entry.keywords.some((keyword) => text.includes(keyword))) found.push(entry.language);
  }
  return found;
}

function detectEducation(text: string): EducationLevel | null {
  for (const entry of EDUCATION_KEYWORDS) {
    if (entry.keywords.some((keyword) => text.includes(keyword))) return entry.level;
  }
  return null;
}

function detectEmploymentType(text: string): EmploymentType | null {
  for (const entry of EMPLOYMENT_TYPE_KEYWORDS) {
    if (entry.keywords.some((keyword) => text.includes(keyword))) return entry.type;
  }
  return null;
}

function detectWorkMode(text: string): WorkMode | null {
  if (/\b(hybrid)\b/.test(text)) return 'hybrid';
  if (/\b(remote|work from home|online|kazi ya nyumbani)\b/.test(text)) return 'remote';
  if (/\b(onsite|on-site|on site)\b/.test(text)) return 'onsite';
  return null;
}

/** Pulls "eight female hotel attendants" out of a "we require ..." sentence. */
function parseRequirementSentence(text: string): { count: number | null; title: string | null } {
  const pattern =
    /\b(?:we\s+(?:require|need|are\s+looking\s+for|want|seek)|required|urgently\s+needed|wanted|tunahitaji|zinahitajika|wanahitajika|inahitajika)\b\s*[:\-]?\s*([^.!\n]+)/i;
  const match = pattern.exec(text);
  if (!match) return { count: null, title: null };

  // Cut trailing context: "... attendants to work in Zanzibar" / "... for our hotel".
  const phrase = (match[1] ?? '').split(/\s+(?:to|for|in|at|kwa|katika)\s+/i)[0] ?? '';
  const stopWords = new Set([
    'a', 'an', 'the', 'our', 'urgent', 'urgently', 'qualified', 'experienced', 'smart',
    'young', 'energetic', 'hardworking', 'reliable', 'and', 'of', 'new', 'more',
    ...FEMALE_WORDS, ...MALE_WORDS,
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

function parseAgeRange(text: string): { min: number | null; max: number | null; evidence: string } | null {
  const range = /(?:age|umri|miaka|aged)[^\d]{0,15}(\d{2})\s*(?:-|–|—|to|hadi|na)\s*(\d{2})/i.exec(text)
    ?? /\b(\d{2})\s*(?:-|–|—|to|hadi)\s*(\d{2})\s*(?:years|yrs|miaka)\b/i.exec(text);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    if (min >= 14 && max <= 75 && max > min) return { min, max, evidence: range[0] };
  }
  const minOnly = /(?:at least|minimum|above|over|zaidi ya|angalau)\s*(\d{2})\s*(?:years|yrs|miaka)/i.exec(text);
  if (minOnly) {
    const min = Number(minOnly[1]);
    if (min >= 14 && min <= 75) return { min, max: null, evidence: minOnly[0] };
  }
  return null;
}

const COUNT_TOKEN = '\\d+|one|two|three|four|five|six|seven|eight|nine|ten|moja|mbili|tatu|nne|tano';

function parseExperienceYears(text: string): { years: number; evidence: string } | null {
  // English puts the number first ("3 years"); Swahili puts the unit first
  // ("miaka 3"). Both spellings appear on Soko Huru posters.
  const match =
    new RegExp(`(${COUNT_TOKEN})\\s*(?:\\+|plus)?\\s*(?:years?|yrs?|miaka)\\b`, 'i').exec(text) ??
    new RegExp(`(?:miaka|years?)\\s*(${COUNT_TOKEN})\\b`, 'i').exec(text);
  if (!match) return null;
  const years = parseCount(match[1] ?? '');
  if (years === null || years > 40) return null;
  return { years, evidence: match[0] };
}

function detectCertificateRequirement(text: string): boolean | null {
  if (/\b(no certificate|without certificate|certificate not required|hakuna cheti|bila cheti|no qualification)\b/i.test(text)) {
    return false;
  }
  if (/\b(certificate required|certificate is required|must have.{0,20}certificate|cheti kinahitajika|lazima uwe na cheti|certified)\b/i.test(text)) {
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

/**
 * The default Kobe AI extractor: deterministic, offline, and auditable. Every
 * value it produces carries the line it came from so Soko Huru staff can check
 * the extraction against the poster before pressing Publish.
 */
export class RuleBasedExtractor implements VacancyExtractor {
  readonly name = 'kobe-rules-v1';

  extract(rawText: string): ExtractionResult {
    const lines = toLines(rawText);
    const collector = new Collector();
    const wholeText = lines.join('\n');
    const lowerWhole = wholeText.toLowerCase();

    for (const line of lines) {
      this.readLabelledLine(collector, line);
    }
    this.readFreeform(collector, lines, lowerWhole);
    this.applyDefaults(collector, lowerWhole);

    const confidence = collector.list();
    const needsReview = this.flagForReview(collector);

    return {
      vacancy: collector.vacancy,
      confidence,
      needsReview,
      extractor: this.name,
      detectedLanguage: detectLanguage(lowerWhole),
    };
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
      case 'accommodationProvided':
        collector.set('accommodationProvided', parseBooleanish(value) ?? true, CONFIDENCE.label, line);
        break;
      case 'mealsProvided':
        collector.set('mealsProvided', parseBooleanish(value) ?? true, CONFIDENCE.label, line);
        break;
      case 'transportProvided':
        collector.set('transportProvided', parseBooleanish(value) ?? true, CONFIDENCE.label, line);
        break;
      case 'employmentType':
        collector.set('employmentType', detectEmploymentType(lower), CONFIDENCE.label, line);
        break;
      case 'workMode':
        collector.set('workMode', detectWorkMode(lower), CONFIDENCE.label, line);
        break;
      case 'genderRequirement':
        collector.set('genderRequirement', detectGender(lower) ?? 'any', CONFIDENCE.label, line);
        break;
      case 'ageMin': {
        const age = parseAgeRange(`age ${value}`);
        if (age) {
          collector.set('ageMin', age.min, CONFIDENCE.label, line);
          collector.set('ageMax', age.max, CONFIDENCE.label, line);
        }
        break;
      }
      case 'languages': {
        const languages = detectLanguages(lower);
        if (languages.length > 0) collector.set('languages', languages, CONFIDENCE.label, line);
        break;
      }
      case 'experienceYearsMin': {
        collector.set('experienceNote', value, CONFIDENCE.label, line);
        const years = parseExperienceYears(value);
        collector.set('experienceYearsMin', years?.years ?? 0, years ? CONFIDENCE.label : CONFIDENCE.inferred, line);
        break;
      }
      case 'educationMin':
        collector.set('educationMin', detectEducation(lower), CONFIDENCE.label, line);
        break;
      case 'certificateRequired':
        collector.set('certificateRequired', parseBooleanish(value) ?? true, CONFIDENCE.label, line);
        break;
      case 'startDate':
        if (hasAnyWord(lower, IMMEDIATE_WORDS)) {
          collector.set('immediateStart', true, CONFIDENCE.label, line);
        } else {
          collector.set('startDate', value, CONFIDENCE.label, line);
          collector.set('immediateStart', false, CONFIDENCE.label, line);
        }
        break;
      case 'applicationDeadline':
        collector.set('applicationDeadline', value, CONFIDENCE.label, line);
        break;
      default:
        break;
    }
  }

  private readFreeform(collector: Collector, lines: string[], lowerWhole: string): void {
    const requirement = parseRequirementSentence(lowerWhole);
    if (requirement.count !== null) {
      collector.set('positions', requirement.count, CONFIDENCE.pattern, 'requirement sentence');
    }
    if (requirement.title !== null) {
      collector.set('title', requirement.title, CONFIDENCE.pattern, 'requirement sentence');
    }

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

    const age = parseAgeRange(lowerWhole);
    if (age) {
      collector.set('ageMin', age.min, CONFIDENCE.pattern, age.evidence);
      collector.set('ageMax', age.max, CONFIDENCE.pattern, age.evidence);
    }

    for (const line of lines) {
      const lower = line.toLowerCase();

      if (hasAnyWord(lower, ['accommodation', 'housing', 'malazi'])) {
        collector.set('accommodationProvided', parseBooleanish(lower) ?? true, CONFIDENCE.keyword, line);
      }
      if (hasAnyWord(lower, ['meals', 'food', 'chakula'])) {
        collector.set('mealsProvided', parseBooleanish(lower) ?? true, CONFIDENCE.keyword, line);
      }
      if (hasAnyWord(lower, ['transport', 'usafiri'])) {
        collector.set('transportProvided', parseBooleanish(lower) ?? true, CONFIDENCE.keyword, line);
      }
      if (hasAnyWord(lower, ['experience', 'uzoefu'])) {
        collector.set('experienceNote', line, CONFIDENCE.keyword, line);
        const years = parseExperienceYears(lower);
        if (years) collector.set('experienceYearsMin', years.years, CONFIDENCE.pattern, line);
      }
      if (hasAnyWord(lower, IMMEDIATE_WORDS)) {
        collector.set('immediateStart', true, CONFIDENCE.pattern, line);
      }
    }

    const languages = detectLanguages(lowerWhole);
    if (languages.length > 0) collector.set('languages', languages, CONFIDENCE.keyword, 'language keywords');

    const education = detectEducation(lowerWhole);
    if (education) collector.set('educationMin', education, CONFIDENCE.keyword, 'education keywords');

    const certificate = detectCertificateRequirement(lowerWhole);
    if (certificate !== null) collector.set('certificateRequired', certificate, CONFIDENCE.pattern, 'certificate wording');

    const gender = detectGender(lowerWhole);
    if (gender) collector.set('genderRequirement', gender, CONFIDENCE.keyword, 'gender wording');

    const employmentType = detectEmploymentType(lowerWhole);
    if (employmentType) collector.set('employmentType', employmentType, CONFIDENCE.keyword, 'employment type wording');

    const workMode = detectWorkMode(lowerWhole);
    if (workMode) collector.set('workMode', workMode, CONFIDENCE.keyword, 'work mode wording');

    const titleSource = collector.vacancy.title ?? '';
    const category = detectCategory(titleSource.toLowerCase()) ?? detectCategory(lowerWhole);
    if (category) {
      collector.set('category', category, titleSource ? CONFIDENCE.keyword : CONFIDENCE.inferred, 'category keywords');
    }
  }

  /** Fills the blanks a Tanzanian vacancy can safely assume, at low confidence. */
  private applyDefaults(collector: Collector, lowerWhole: string): void {
    collector.set('category', 'other', CONFIDENCE.assumed, 'default');
    collector.set('positions', 1, CONFIDENCE.assumed, 'default: one position');
    collector.set('employmentType', 'full_time', CONFIDENCE.assumed, 'default');
    collector.set('workMode', 'onsite', CONFIDENCE.assumed, 'default');
    collector.set('genderRequirement', 'any', CONFIDENCE.assumed, 'default: open to all');
    collector.set('accommodationProvided', false, CONFIDENCE.assumed, 'default');
    collector.set('mealsProvided', false, CONFIDENCE.assumed, 'default');
    collector.set('transportProvided', false, CONFIDENCE.assumed, 'default');
    collector.set('experienceYearsMin', 0, CONFIDENCE.assumed, 'default: no experience stated');
    collector.set('immediateStart', hasAnyWord(lowerWhole, IMMEDIATE_WORDS), CONFIDENCE.assumed, 'default');

    // A stated qualification of certificate level or above implies a certificate job,
    // which is what decides the membership package an applicant needs.
    const education = collector.vacancy.educationMin;
    const impliesCertificate = education === 'certificate' || education === 'diploma' || education === 'degree' || education === 'postgraduate';
    collector.set('certificateRequired', impliesCertificate, impliesCertificate ? CONFIDENCE.inferred : CONFIDENCE.assumed, 'implied by stated education');
    collector.set('educationMin', 'none', CONFIDENCE.assumed, 'default');
  }

  private flagForReview(collector: Collector): Field[] {
    const flagged = new Set<Field>();
    for (const field of REQUIRED_FIELDS) {
      if (collector.vacancy[field] === null) flagged.add(field);
    }
    for (const entry of collector.list()) {
      if (entry.confidence < REVIEW_THRESHOLD) flagged.add(entry.field);
    }
    return [...flagged].sort();
  }
}

/**
 * Wraps any text-completion function as an extractor, so a hosted model can be
 * dropped in without touching the intake service. The completion must return
 * JSON shaped like ExtractedVacancy; anything it omits or gets wrong falls back
 * to the rule-based result, which also supplies the evidence trail.
 */
export class AssistedExtractor implements VacancyExtractor {
  readonly name: string;
  private readonly complete: (prompt: string) => Promise<string>;
  private readonly fallback = new RuleBasedExtractor();

  constructor(complete: (prompt: string) => Promise<string>, name = 'kobe-assisted-v1') {
    this.complete = complete;
    this.name = name;
  }

  async extract(rawText: string): Promise<ExtractionResult> {
    const base = this.fallback.extract(rawText);
    let parsed: Partial<ExtractedVacancy> | null = null;
    try {
      const response = await this.complete(buildExtractionPrompt(rawText));
      parsed = JSON.parse(response) as Partial<ExtractedVacancy>;
    } catch {
      return base; // A model failure must never block Soko Huru from publishing.
    }

    const merged: ExtractedVacancy = { ...base.vacancy };
    const confidence = new Map(base.confidence.map((entry) => [entry.field, entry]));
    for (const [key, value] of Object.entries(parsed) as [Field, unknown][]) {
      if (value === null || value === undefined || !(key in merged)) continue;
      const existing = confidence.get(key);
      if (existing && existing.confidence >= CONFIDENCE.label) continue;
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
      vacancy: merged,
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
    Object.keys(EMPTY_VACANCY).join(', '),
    'Use null for anything the post does not state. Do not invent details.',
    '',
    'POST:',
    cleanLine(rawText),
  ].join('\n');
}
