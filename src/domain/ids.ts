import { randomBytes, randomUUID } from 'node:crypto';

/** Short, sortable-enough identifiers that read well in logs and URLs. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Six-digit human codes for OTPs. */
export function randomNumericCode(digits = 6): string {
  const max = 10 ** digits;
  return String(randomBytes(4).readUInt32BE(0) % max).padStart(digits, '0');
}

// No I, O, 0 or 1: these codes get read down a phone line.
const SHORT_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** The code in an employer's private link, e.g. the 7HK29D in /e/7HK29D. */
export function randomShortCode(length = 6): string {
  const bytes = randomBytes(length);
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += SHORT_CODE_ALPHABET[(bytes[index] ?? 0) % SHORT_CODE_ALPHABET.length];
  }
  return code;
}

/** Builds the applicant-facing application number, e.g. SH-2026-001284. */
export function formatApplicationReference(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(6, '0')}`;
}

/** Builds the agency's internal job reference, e.g. SH-JOB-2026-0007. */
export function formatJobReference(prefix: string, year: number, sequence: number): string {
  return `${prefix}-JOB-${year}-${String(sequence).padStart(4, '0')}`;
}
