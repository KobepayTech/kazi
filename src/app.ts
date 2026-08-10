import { timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { loadConfig, type AppConfig } from './config.ts';
import { openDatabase } from './data/db.ts';
import { Store, type SessionSubject, type TenantStore } from './data/store.ts';
import { RuleBasedExtractor } from './domain/extraction.ts';
import type { JobExtractor, Tenant } from './domain/types.ts';
import { AccessService, hashSecret, hashToken, verifySecret } from './services/access.ts';
import { AgencyService } from './services/agency.ts';
import { ApplicantService } from './services/applicants.ts';
import { EmployerService } from './services/employer.ts';
import { EventBus } from './services/events.ts';
import { IntakeService } from './services/intake.ts';
import { MembershipService } from './services/memberships.ts';
import { SwipeService } from './services/swipe.ts';
import { UploadService } from './services/uploads.ts';

/** Everything scoped to one recruitment agency. */
export type TenantContext = {
  tenant: Tenant;
  store: TenantStore;
  bus: EventBus;
  access: AccessService;
  intake: IntakeService;
  applicants: ApplicantService;
  memberships: MembershipService;
  swipe: SwipeService;
  employer: EmployerService;
  agency: AgencyService;
};

export type Platform = {
  config: AppConfig;
  db: DatabaseSync;
  store: Store;
  uploads: UploadService;
  /** The tenant created on an empty database - Soko Huru today. */
  defaultTenant: Tenant;
  tenantContext(tenantId: string): TenantContext;
  /** Resolves an agency API key to its tenant, in constant time. */
  tenantForApiKey(key: string | null): TenantContext | null;
  /** Resolves a bearer token to its tenant and subject. */
  sessionContext(token: string | null): { context: TenantContext; subject: SessionSubject } | null;
  createTenant(name: string, slug: string, apiKey: string): TenantContext;
  close(): void;
};

export type CreatePlatformOptions = {
  config?: Partial<AppConfig>;
  extractor?: JobExtractor;
};

export function createPlatform(options: CreatePlatformOptions = {}): Platform {
  const config: AppConfig = { ...loadConfig(), ...options.config };
  const db = openDatabase(config.databasePath);
  const store = new Store(db);
  const uploads = new UploadService(config);
  const extractor = options.extractor ?? new RuleBasedExtractor();
  const contexts = new Map<string, TenantContext>();

  function build(tenant: Tenant): TenantContext {
    const tenantStore = store.forTenant(tenant.id);
    const bus = new EventBus(tenantStore);
    const access = new AccessService(store, tenantStore, config);
    const intake = new IntakeService(store, tenantStore, tenant, bus, access, config, extractor);
    const memberships = new MembershipService(tenantStore, bus);
    const context: TenantContext = {
      tenant,
      store: tenantStore,
      bus,
      access,
      intake,
      applicants: new ApplicantService(tenantStore),
      memberships,
      swipe: new SwipeService(tenantStore, tenant, bus),
      employer: new EmployerService(tenantStore, bus),
      agency: new AgencyService(tenantStore, bus, access, (code) => intake.linkFor(code)),
    };
    contexts.set(tenant.id, context);
    return context;
  }

  function tenantContext(tenantId: string): TenantContext {
    const cached = contexts.get(tenantId);
    if (cached !== undefined) return cached;
    const tenant = store.getTenant(tenantId);
    if (tenant === null) throw new Error(`unknown tenant ${tenantId}`);
    return build(tenant);
  }

  function createTenant(name: string, slug: string, apiKey: string): TenantContext {
    const tenant = store.createTenant(name, slug, hashSecret(apiKey));
    const context = build(tenant);
    context.memberships.seedDefaultPlans();
    return context;
  }

  // Bootstrap the first agency so a fresh database is immediately usable.
  const existing = store.getTenantBySlug(config.defaultTenantSlug);
  const defaultContext =
    existing !== null
      ? tenantContext(existing.id)
      : createTenant(config.defaultTenantName, config.defaultTenantSlug, config.defaultTenantApiKey);

  return {
    config,
    db,
    store,
    uploads,
    defaultTenant: defaultContext.tenant,

    tenantContext,

    tenantForApiKey(key: string | null): TenantContext | null {
      if (key === null || key.length === 0) return null;
      // Compare against every tenant so a wrong key costs the same everywhere.
      let matched: string | null = null;
      for (const row of store.listTenantKeyHashes()) {
        if (verifySecret(key, row.apiKeyHash)) matched = row.tenantId;
      }
      return matched === null ? null : tenantContext(matched);
    },

    sessionContext(token: string | null) {
      if (token === null || token.length === 0) return null;
      const subject = store.getSession(hashToken(token));
      if (subject === null) return null;
      return { context: tenantContext(subject.tenantId), subject };
    },

    createTenant,

    close() {
      db.close();
    },
  };
}

/** Constant-time comparison for short opaque strings. */
export function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
