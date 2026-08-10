import { randomBytes, randomUUID } from 'node:crypto';

/** Short, sortable-enough identifiers that read well in logs and URLs. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Six-digit human codes for employer one-time access and OTPs. */
export function randomNumericCode(digits = 6): string {
  const max = 10 ** digits;
  const value = randomBytes(4).readUInt32BE(0) % max;
  return String(value).padStart(digits, '0');
}

/** Builds the applicant-facing application number, e.g. SH-2026-001284. */
export function formatApplicationReference(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(6, '0')}`;
}
