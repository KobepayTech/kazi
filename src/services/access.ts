import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../config.ts';
import type { SessionSubject, Store, TenantStore } from '../data/store.ts';
import { randomNumericCode, randomToken } from '../domain/ids.ts';
import type { Employer } from '../domain/types.ts';
import { AppError } from './errors.ts';

const SCRYPT_KEYLEN = 32;

/** scrypt with a per-secret salt, stored as `scrypt$<salt>$<hash>`. */
export function hashSecret(secret: string): string {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(secret, salt, SCRYPT_KEYLEN).toString('hex')}`;
}

export function verifySecret(secret: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const expected = Buffer.from(parts[2] ?? '', 'hex');
  if (expected.length !== SCRYPT_KEYLEN) return false;
  return timingSafeEqual(expected, scryptSync(secret, parts[1] ?? '', SCRYPT_KEYLEN));
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type AccessKind = 'access_code' | 'email_otp' | 'phone_otp';

export type IssuedSecret = {
  /** Shown to agency staff once, so they can pass it to the client. */
  secret: string;
  kind: AccessKind;
  destination: string | null;
  expiresAt: string | null;
};

export type Session = { token: string; expiresAt: string };

/**
 * Access to the private employer link and the applicant app.
 *
 * The short code in /e/7HK29D only names the employer. What proves it is
 * really them is a separate access code or an OTP, so a forwarded link is not
 * a credential on its own.
 */
export class AccessService {
  private readonly platform: Store;
  private readonly store: TenantStore;
  private readonly config: AppConfig;

  constructor(platform: Store, store: TenantStore, config: AppConfig) {
    this.platform = platform;
    this.store = store;
    this.config = config;
  }

  /** A fresh access code for the employer, replacing any previous one. */
  issueAccessCode(employerId: string, ttlMinutes = 60 * 24 * 30): IssuedSecret {
    const code = randomNumericCode(6);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
    this.store.revokeGrants(employerId, 'access_code');
    this.store.createAccessGrant({
      employerId,
      kind: 'access_code',
      secretHash: hashSecret(code),
      expiresAt,
    });
    return { secret: code, kind: 'access_code', destination: null, expiresAt };
  }

  issueOtp(employer: Employer, kind: 'email_otp' | 'phone_otp'): IssuedSecret {
    const destination = kind === 'email_otp' ? employer.contactEmail : employer.contactPhone;
    if (destination === null || destination.length === 0) {
      throw AppError.badRequest(
        'missing_destination',
        'No contact details on file for this client. Ask the agency to send you an access code instead.',
      );
    }
    const code = randomNumericCode(6);
    const expiresAt = new Date(Date.now() + this.config.otpTtlMinutes * 60_000).toISOString();
    this.store.revokeGrants(employer.id, kind);
    this.store.createAccessGrant({
      employerId: employer.id,
      kind,
      secretHash: hashSecret(code),
      destination,
      expiresAt,
    });
    return { secret: code, kind, destination, expiresAt };
  }

  /**
   * Checks a secret against the live grants of that kind. OTPs are consumed on
   * success; the standing access code is not.
   */
  authenticateEmployer(employer: Employer, kind: AccessKind, secret: string): Session {
    const grants = this.store.listUsableGrants(employer.id, kind);
    for (const grant of grants) {
      if (grant.attempts >= this.config.maxOtpAttempts) continue;
      if (!verifySecret(secret, grant.secretHash)) {
        this.store.bumpGrantAttempts(grant.id);
        continue;
      }
      if (kind !== 'access_code') this.store.markGrantUsed(grant.id);
      return this.startEmployerSession(employer.id);
    }
    throw AppError.unauthorised('That code is not valid. Ask the agency to send you a new one.');
  }

  startEmployerSession(employerId: string): Session {
    this.store.markEmployerSeen(employerId);
    return this.createSession({ tenantId: this.store.tenantId, kind: 'employer', id: employerId });
  }

  startApplicantSession(applicantId: string): Session {
    if (this.store.getApplicant(applicantId) === null) throw AppError.notFound('Applicant not found.');
    return this.createSession({ tenantId: this.store.tenantId, kind: 'applicant', id: applicantId });
  }

  private createSession(subject: SessionSubject): Session {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + this.config.sessionTtlMinutes * 60_000).toISOString();
    this.platform.createSession(hashToken(token), subject, expiresAt);
    return { token, expiresAt };
  }

  requireEmployer(token: string | null): Employer {
    const subject = this.subjectFor(token);
    if (subject.kind !== 'employer') throw AppError.unauthorised();
    const employer = this.store.getEmployer(subject.id);
    if (employer === null) throw AppError.unauthorised();
    this.store.markEmployerSeen(employer.id);
    return employer;
  }

  requireApplicantId(token: string | null): string {
    const subject = this.subjectFor(token);
    if (subject.kind !== 'applicant') throw AppError.unauthorised();
    return subject.id;
  }

  private subjectFor(token: string | null): SessionSubject {
    if (token === null || token.length === 0) throw AppError.unauthorised();
    const subject = this.platform.getSession(hashToken(token));
    if (subject === null) throw AppError.unauthorised('Your session has expired. Please sign in again.');
    // A session from another tenant is not a session here.
    if (subject.tenantId !== this.store.tenantId) throw AppError.unauthorised();
    return subject;
  }

  logout(token: string): void {
    this.platform.deleteSession(hashToken(token));
  }
}
