import type { Currency, SalaryPeriod } from './domain/types.ts';

/**
 * Exchange rates used to normalise every advertised salary into a monthly TZS
 * figure, so "minimum TSh 500,000" can compare a USD hotel wage with a TZS
 * call-centre wage. The agency's finance team keeps these current.
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

/** Extraction confidence below this is flagged for a human before publishing. */
export const REVIEW_THRESHOLD = 0.7;

/** Prefix for application numbers, e.g. SH-2026-001284. */
export const APPLICATION_REFERENCE_PREFIX = 'SH';

export type AppConfig = {
  databasePath: string;
  port: number;
  /** Base for the short employer links, e.g. https://jobs.kobeos.app/e/7HK29D. */
  publicBaseUrl: string;
  uploadsDir: string;
  maxUploadBytes: number;
  sessionTtlMinutes: number;
  otpTtlMinutes: number;
  maxOtpAttempts: number;
  /** Bootstrap tenant created on an empty database. */
  defaultTenantName: string;
  defaultTenantSlug: string;
  /** API key for the bootstrap tenant's console. */
  defaultTenantApiKey: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    databasePath: env.KOBEOS_DB ?? 'data/kobeos.db',
    port: Number(env.PORT ?? 3000),
    publicBaseUrl: (env.KOBEOS_PUBLIC_URL ?? 'https://jobs.kobeos.app').replace(/\/+$/, ''),
    uploadsDir: env.KOBEOS_UPLOADS_DIR ?? 'data/uploads',
    maxUploadBytes: Number(env.KOBEOS_MAX_UPLOAD_BYTES ?? 5_000_000),
    sessionTtlMinutes: Number(env.KOBEOS_SESSION_TTL_MINUTES ?? 720),
    otpTtlMinutes: Number(env.KOBEOS_OTP_TTL_MINUTES ?? 10),
    maxOtpAttempts: Number(env.KOBEOS_MAX_OTP_ATTEMPTS ?? 5),
    defaultTenantName: env.KOBEOS_TENANT_NAME ?? 'Soko Huru',
    defaultTenantSlug: env.KOBEOS_TENANT_SLUG ?? 'soko-huru',
    defaultTenantApiKey: env.KOBEOS_TENANT_KEY ?? 'dev-agency-key',
  };
}

/** True when the tenant key is still the development default. */
export function usingDefaultTenantKey(config: AppConfig): boolean {
  return config.defaultTenantApiKey === 'dev-agency-key';
}
