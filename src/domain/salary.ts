import { FX_TO_TZS, PERIOD_TO_MONTH } from '../config.ts';
import type { Currency, Salary, SalaryPeriod } from './types.ts';
import { formatAmount } from './text.ts';

const CURRENCY_PATTERNS: ReadonlyArray<{ currency: Currency; pattern: RegExp }> = [
  { currency: 'USD', pattern: /\b(usd|us\$|dollars?|dola)\b|\$/i },
  { currency: 'EUR', pattern: /\b(eur|euros?)\b|€/i },
  { currency: 'KES', pattern: /\b(kes|ksh|kshs)\b/i },
  { currency: 'TZS', pattern: /\b(tzs|tsh|tshs|tzsh|shilingi|shillings?)\b/i },
];

const PERIOD_PATTERNS: ReadonlyArray<{ period: SalaryPeriod; pattern: RegExp }> = [
  { period: 'hour', pattern: /\b(per hour|hourly|an hour|\/ ?hour|\/ ?hr|kwa saa)\b/i },
  { period: 'day', pattern: /\b(per day|daily|a day|\/ ?day|kwa siku)\b/i },
  { period: 'week', pattern: /\b(per week|weekly|a week|\/ ?week|kwa wiki)\b/i },
  { period: 'year', pattern: /\b(per year|yearly|annually|per annum|\/ ?year|kwa mwaka)\b/i },
  { period: 'month', pattern: /\b(per month|monthly|a month|\/ ?month|\/ ?mo|kwa mwezi)\b/i },
];

const TIPS_PATTERN = /\b(plus tips|\+ ?tips|and tips|with tips|na tips|pamoja na tips|tips)\b/i;

/** Words that mark a line as being about pay, so we do not read ages as money. */
export const SALARY_KEYWORDS: readonly string[] = [
  'salary',
  'wage',
  'pay',
  'payment',
  'mshahara',
  'malipo',
  'ujira',
  'posho',
];

/** Converts an advertised amount into the monthly TZS figure used for filtering. */
export function toMonthlyTzs(amount: number, currency: Currency, period: SalaryPeriod): number {
  return Math.round(amount * FX_TO_TZS[currency] * PERIOD_TO_MONTH[period]);
}

export function withMonthlyTzs(salary: Omit<Salary, 'monthlyTzs'>): Salary {
  // Filtering uses the low end of a range: an applicant asking for at least
  // TSh 500,000 should only see jobs that are guaranteed to clear that.
  const base = salary.amountMin ?? salary.amountMax;
  return {
    ...salary,
    monthlyTzs: base === null ? null : toMonthlyTzs(base, salary.currency, salary.period),
  };
}

/**
 * "450,000", "450k" and "1.2m" all become numbers. The k/m suffix has to be
 * attached to the digits - a space in between means the letter belongs to the
 * next word ("600,000 kwa mwezi" is six hundred thousand, not 600 million).
 */
function parseAmountToken(token: string): number | null {
  const cleaned = token.replace(/,/g, '').trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)([km])?$/.exec(cleaned);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  if (match[2] === 'k') return value * 1_000;
  if (match[2] === 'm') return value * 1_000_000;
  return value;
}

/** Digits with an optional attached k/m suffix - never a space before it. */
const AMOUNT = String.raw`\d[\d,]*(?:\.\d+)?[km]?\b`;

/**
 * Reads a pay line such as "Salary: USD 200 plus tips" or
 * "Mshahara: TSh 450,000 - 600,000 kwa mwezi".
 * Returns null when the line carries no currency marker and no pay keyword,
 * which keeps age ranges and phone numbers out of the salary field.
 */
export function parseSalary(text: string): Salary | null {
  const hasCurrency = CURRENCY_PATTERNS.some((entry) => entry.pattern.test(text));
  const hasKeyword = SALARY_KEYWORDS.some((word) => new RegExp(`\\b${word}\\b`, 'i').test(text));
  if (!hasCurrency && !hasKeyword) return null;

  const amounts: number[] = [];
  for (const match of text.matchAll(new RegExp(`(${AMOUNT})`, 'gi'))) {
    const value = parseAmountToken(match[1] ?? '');
    // Years ("2026") and small counts are not pay; require a plausible wage.
    if (value !== null && value >= 10) amounts.push(value);
  }
  if (amounts.length === 0) return null;

  const currency = CURRENCY_PATTERNS.find((entry) => entry.pattern.test(text))?.currency ?? 'TZS';
  const period = PERIOD_PATTERNS.find((entry) => entry.pattern.test(text))?.period ?? 'month';

  const rangeMatch = new RegExp(`(${AMOUNT})\\s*(?:-|–|—|to|hadi|na)\\s*(${AMOUNT})`, 'i').exec(text);
  let amountMin = amounts[0] ?? null;
  let amountMax: number | null = null;
  if (rangeMatch) {
    const low = parseAmountToken(rangeMatch[1] ?? '');
    const high = parseAmountToken(rangeMatch[2] ?? '');
    if (low !== null && high !== null && high >= low) {
      amountMin = low;
      amountMax = high;
    }
  }

  return withMonthlyTzs({
    amountMin,
    amountMax,
    currency,
    period,
    plusTips: TIPS_PATTERN.test(text),
  });
}

const PERIOD_LABEL: Record<SalaryPeriod, string> = {
  hour: 'per hour',
  day: 'per day',
  week: 'per week',
  month: 'per month',
  year: 'per year',
};

const CURRENCY_LABEL: Record<Currency, string> = {
  TZS: 'TSh',
  USD: 'USD',
  KES: 'KSh',
  EUR: 'EUR',
};

/** The single pay line printed on the swipe card. */
export function formatSalaryLine(salary: Salary): string {
  if (salary.amountMin === null && salary.amountMax === null) {
    return 'Salary negotiable';
  }
  const symbol = CURRENCY_LABEL[salary.currency];
  const low = salary.amountMin === null ? null : `${symbol} ${formatAmount(salary.amountMin)}`;
  const high = salary.amountMax === null ? null : formatAmount(salary.amountMax);
  const amount = high === null ? low : `${low} - ${high}`;
  return [amount, PERIOD_LABEL[salary.period], salary.plusTips ? '+ tips' : null]
    .filter((part) => part !== null)
    .join(' ');
}
