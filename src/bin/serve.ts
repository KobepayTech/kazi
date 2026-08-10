import { createApp } from '../app.ts';
import { usingDefaultAgencyKey } from '../config.ts';
import { startServer } from '../http/server.ts';

const app = createApp();
const server = await startServer(app);

const address = server.address();
const port = typeof address === 'object' && address !== null ? address.port : app.config.port;

console.log(`KobeOS listening on http://localhost:${port}`);
console.log(`  applicant swipe deck   http://localhost:${port}/swipe`);
console.log(`  Soko Huru console      http://localhost:${port}/agency`);
console.log(`  employer portals       ${app.config.portalBaseUrl}/client/<slug>`);
if (usingDefaultAgencyKey(app.config)) {
  console.warn('  WARNING: using the default agency key. Set KOBEOS_AGENCY_KEY before deploying.');
}

// Expired sessions and lapsed memberships are cheap to sweep hourly.
const sweep = setInterval(() => {
  app.store.purgeExpiredSessions();
  app.memberships.expireLapsed();
}, 3_600_000);
sweep.unref();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(sweep);
    server.close(() => {
      app.close();
      process.exit(0);
    });
  });
}
