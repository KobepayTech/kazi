import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../config.ts';
import type { Store } from '../data/store.ts';
import { randomNumericCode, randomToken } from '../domain/ids.ts';
import type { AccessGrantKind, Employer } from '../domain/types.ts';
import { AppError } from './errors.ts';

const SCRYPT_KEYLEN = 32;

/** scrypt with a per-secret salt, stored as `scrypt$<salt>$<hash>`. */
export function hashSecret(secret: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(secret, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifySecret(secret: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = parts[1] ?? '';
  const expected = Buffer.from(parts[2] ?? '', 'hex');
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const actual = scryptSync(secret, salt, SCRYPT_KEYLEN);
  return timingSafeEqual(expected, actual);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type IssuedSecret = {
  /** Shown to Soko Huru staff exactly once so they can pass it to the client. */
  secret: string;
  kind: AccessGrantKind;
  expiresAt: string | null;
};

export type EmployerSession = {
  token: string;
  employerId: string;
  expiresAt: string;
};

/**
 * Employer access to the auto-generated recruitment page. Soko Huru can hand a
 * client a password, a one-time access code, or an OTP sent to their email or
 * phone - all four are the same grant record with a different kind.
 */
export class AccessService {
  private readonly store: Store;
  private readonly config: AppConfig;

  constructor(store: Store, config: AppConfig) {
    this.store = store;
    this.config = config;
  }

  setPassword(employerId: string, password: string): void {
    if (password.length < 8) {
      throw AppError.badRequest('weak_password', 'Employer passwords must be at least 8 characters.');
    }
    this.store.revokeGrants(employerId, 'password');
    this.store.createAccessGrant({ employerId, kind: 'password', secretHash: hashSecret(password) });
  }

  /** A code Soko Huru reads out to the client; valid until used. */
  issueOneTimeCode(employerId: string, ttlMinutes = 60 * 24 * 7): IssuedSecret {
    const code = randomNumericCode(8);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
    this.store.revokeGrants(employerId, 'one_time_code');
    this.store.createAccessGrant({ employerId, kind: 'one_time_code', secretHash: hashSecret(code), expiresAt });
    return { secret: code, kind: 'one_time_code', expiresAt };
  }

  issueOtp(employerId: string, kind: 'email_otp' | 'phone_otp', destination: string): IssuedSecret {
    const code = randomNumericCode(6);
    const expiresAt = new Date(Date.now() + this.config.otpTtlMinutes * 60_000).toISOString();
    this.store.revokeGrants(employerId, kind);
    this.store.createAccessGrant({ employerId, kind, secretHash: hashSecret(code), destination, expiresAt });
    return { secret: code, kind, expiresAt };
  }

  /**
   * Checks a secret against every live grant of that kind. One-time codes and
   * OTPs are consumed on success; passwords are not.
   */
  authenticate(employer: Employer, kind: AccessGrantKind, secret: string): EmployerSession {
    const grants = this.store.listUsableGrants(employer.id, kind);
    if (grants.length === 0) {
      throw AppError.unauthorised('That access code is not valid. Ask Soko Huru to resend your link.');
    }
    for (const grant of grants) {
      if (grant.attempts >= this.config.maxOtpAttempts) continue;
      if (!verifySecret(secret, grant.secretHash)) {
        this.store.bumpGrantAttempts(grant.id);
        continue;
      }
      if (kind !== 'password') this.store.markGrantUsed(grant.id);
      return this.startSession(employer.id);
    }
    throw AppError.unauthorised('That access code is not valid. Ask Soko Huru to resend your link.');
  }

  startSession(employerId: string): EmployerSession {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + this.config.sessionTtlMinutes * 60_000).toISOString();
    this.store.createSession(hashToken(token), employerId, expiresAt);
    this.store.markEmployerSeen(employerId);
    return { token, employerId, expiresAt };
  }

  /** Resolves a bearer token to an employer, refreshing their "last seen" stamp. */
  requireEmployer(token: string | null): Employer {
    if (token === null || token.length === 0) throw AppError.unauthorised();
    const employerId = this.store.getSessionEmployerId(hashToken(token));
    if (employerId === null) throw AppError.unauthorised('Your session has expired. Please sign in again.');
    const employer = this.store.getEmployer(employerId);
    if (employer === null) throw AppError.unauthorised();
    this.store.markEmployerSeen(employerId);
    return employer;
  }

  logout(token: string): void {
    this.store.deleteSession(hashToken(token));
  }

  /**
   * Applicants register through Soko Huru, so their app token is issued by the
   * agency and handed over with the account - there is no self-service signup.
   */
  startApplicantSession(applicantId: string): { token: string; applicantId: string; expiresAt: string } {
    if (this.store.getApplicant(applicantId) === null) throw AppError.notFound('Applicant not found.');
    const token = randomToken();
    const expiresAt = new Date(Date.now() + this.config.sessionTtlMinutes * 60_000).toISOString();
    this.store.createApplicantSession(hashToken(token), applicantId, expiresAt);
    return { token, applicantId, expiresAt };
  }

  requireApplicantId(token: string | null): string {
    if (token === null || token.length === 0) throw AppError.unauthorised();
    const applicantId = this.store.getSessionApplicantId(hashToken(token));
    if (applicantId === null) throw AppError.unauthorised('Your session has expired. Please sign in again.');
    return applicantId;
  }

  logoutApplicant(token: string): void {
    this.store.deleteApplicantSession(hashToken(token));
  }
}
