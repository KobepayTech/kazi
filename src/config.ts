import type { Currency, SalaryPeriod } from './domain/types.ts';

/**
 * Exchange rates used to normalise every advertised salary into a monthly TZS
 * figure so applicant filters ("minimum TSh 500,000") can compare a USD hotel
 * wage against a TZS call-centre wage. Soko Huru finance updates these.
 */
export const FX_TO_TZS: Record<Currency, number> = {
  TZS: 1,
  USD: 2600,
  KES: 20,
  EUR: 2800,
};

/** Multipliers that turn a per-period wage into a monthly figure. */
export const PERIOD_TO_MONTH: Record<SalaryPeriod, number> = {
  hour: 208, // 8 hours x 26 working days
  day: 26,
  week: 4.33,
  month: 1,
  year: 1 / 12,
};

/** Extraction confidence at or below this needs a human look before publishing. */
export const REVIEW_THRESHOLD = 0.7;

/** Reference prefix for application numbers, e.g. SH-2026-001284. */
export const APPLICATION_REFERENCE_PREFIX = 'SH';

export const AGENCY_NAME = 'Soko Huru';

export type AppConfig = {
  databasePath: string;
  port: number;
  /** Base used to build the generated employer portal links. */
  portalBaseUrl: string;
  sessionTtlMinutes: number;
  otpTtlMinutes: number;
  maxOtpAttempts: number;
  /** Shared secret for the Soko Huru console and agency API. */
  agencyApiKey: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    databasePath: env.KOBEOS_DB ?? 'data/kobeos.db',
    port: Number(env.PORT ?? 3000),
    portalBaseUrl: (env.KOBEOS_PORTAL_BASE_URL ?? 'https://sokohuru.kobeos.app').replace(/\/+$/, ''),
    sessionTtlMinutes: Number(env.KOBEOS_SESSION_TTL_MINUTES ?? 720),
    otpTtlMinutes: Number(env.KOBEOS_OTP_TTL_MINUTES ?? 10),
    maxOtpAttempts: Number(env.KOBEOS_MAX_OTP_ATTEMPTS ?? 5),
    agencyApiKey: env.KOBEOS_AGENCY_KEY ?? 'dev-agency-key',
  };
}

/** True when the agency key is still the development default. */
export function usingDefaultAgencyKey(config: AppConfig): boolean {
  return config.agencyApiKey === 'dev-agency-key';
}
