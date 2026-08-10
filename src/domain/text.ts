/** Small text utilities shared by the extractor, matcher and card builder. */

const ENGLISH_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
};

const SWAHILI_NUMBERS: Record<string, number> = {
  moja: 1,
  mbili: 2,
  tatu: 3,
  nne: 4,
  tano: 5,
  sita: 6,
  saba: 7,
  nane: 8,
  tisa: 9,
  kumi: 10,
  ishirini: 20,
  thelathini: 30,
  arobaini: 40,
  hamsini: 50,
};

export const NUMBER_WORDS: Record<string, number> = { ...ENGLISH_NUMBERS, ...SWAHILI_NUMBERS };

/** Strips bullets, emoji and decorative punctuation that posters are full of. */
export function cleanLine(line: string): string {
  return line
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu, ' ')
    .replace(/^[\s*\-–—•·▪◾●>#]+/, '')
    .replace(/[\s*_]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function toLines(rawText: string): string[] {
  return rawText
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((line) => line.length > 0);
}

export function normalise(text: string): string {
  return cleanLine(text).toLowerCase();
}

/** Parses "8", "eight", "nane", "1,200" into a number. */
export function parseCount(token: string): number | null {
  const cleaned = token.trim().toLowerCase().replace(/,/g, '');
  if (/^\d+(\.\d+)?$/.test(cleaned)) {
    const value = Number(cleaned);
    return Number.isFinite(value) ? value : null;
  }
  return NUMBER_WORDS[cleaned] ?? null;
}

export function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'item';
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Case-insensitive whole-word test, used for keyword scanning. */
export function hasWord(haystack: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
}

export function hasAnyWord(haystack: string, words: readonly string[]): boolean {
  return words.some((word) => hasWord(haystack, word));
}

/** Formats a whole-number amount with thousands separators. */
export function formatAmount(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}
