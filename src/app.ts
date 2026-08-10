import type { DatabaseSync } from 'node:sqlite';
import { loadConfig, type AppConfig } from './config.ts';
import { openDatabase } from './data/db.ts';
import { Store } from './data/store.ts';
import { RuleBasedExtractor } from './domain/extraction.ts';
import { DEFAULT_PACKAGES } from './domain/membership.ts';
import type { VacancyExtractor } from './domain/types.ts';
import { AccessService } from './services/access.ts';
import { AgencyService } from './services/agency.ts';
import { EmployerService } from './services/employer.ts';
import { EventBus } from './services/events.ts';
import { IntakeService } from './services/intake.ts';
import { MembershipService } from './services/memberships.ts';
import { SwipeService } from './services/swipe.ts';

export type Kobeos = {
  config: AppConfig;
  db: DatabaseSync;
  store: Store;
  bus: EventBus;
  access: AccessService;
  intake: IntakeService;
  swipe: SwipeService;
  employer: EmployerService;
  agency: AgencyService;
  memberships: MembershipService;
  close(): void;
};

export type CreateAppOptions = {
  config?: Partial<AppConfig>;
  extractor?: VacancyExtractor;
  /** Seeds Soko Huru's published packages on an empty database. */
  seedPackages?: boolean;
};

export function createApp(options: CreateAppOptions = {}): Kobeos {
  const config: AppConfig = { ...loadConfig(), ...options.config };
  const db = openDatabase(config.databasePath);
  const store = new Store(db);

  if (options.seedPackages !== false && store.listPackages().length === 0) {
    for (const pkg of DEFAULT_PACKAGES) store.upsertPackage(pkg);
  }

  const bus = new EventBus(store);
  const access = new AccessService(store, config);
  const intake = new IntakeService(store, bus, access, config, options.extractor ?? new RuleBasedExtractor());
  const swipe = new SwipeService(store, bus);
  const employer = new EmployerService(store, bus);
  const agency = new AgencyService(store, bus, access);
  const memberships = new MembershipService(store, bus);

  return {
    config,
    db,
    store,
    bus,
    access,
    intake,
    swipe,
    employer,
    agency,
    memberships,
    close() {
      db.close();
    },
  };
}
