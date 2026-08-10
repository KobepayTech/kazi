import { createPlatform } from '../app.ts';
import { usingDefaultTenantKey } from '../config.ts';
import { startServer } from '../http/server.ts';

const platform = createPlatform();
const server = await startServer(platform);

const address = server.address();
const port = typeof address === 'object' && address !== null ? address.port : platform.config.port;

console.log(`KobeOS listening on http://localhost:${port}`);
console.log(`  applicant job feed   http://localhost:${port}/jobs`);
console.log(`  agency admin         http://localhost:${port}/admin`);
console.log(`  employer links       ${platform.config.publicBaseUrl}/e/<CODE>`);
console.log(`  tenant               ${platform.defaultTenant.name}`);
if (usingDefaultTenantKey(platform.config)) {
  console.warn('  WARNING: using the default agency key. Set KOBEOS_TENANT_KEY before deploying.');
}

// Expired sessions and lapsed memberships are cheap to sweep hourly.
const sweep = setInterval(() => {
  platform.store.purgeExpiredSessions();
  platform.tenantContext(platform.defaultTenant.id).memberships.expireLapsed();
}, 3_600_000);
sweep.unref();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(sweep);
    server.close(() => {
      platform.close();
      process.exit(0);
    });
  });
}
