import test from 'node:test';
import assert from 'node:assert/strict';
import { hashSecret, verifySecret } from '../src/services/access.ts';
import { makeApp, publish } from './helpers.ts';

test('secrets are stored salted and never in the clear', () => {
  const stored = hashSecret('correct horse battery');
  assert.match(stored, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.ok(!stored.includes('correct horse battery'));
  assert.ok(verifySecret('correct horse battery', stored));
  assert.ok(!verifySecret('wrong', stored));
  // A fresh salt each time, so identical passwords do not collide.
  assert.notEqual(hashSecret('same'), hashSecret('same'));
});

test('a malformed stored hash never verifies', () => {
  assert.ok(!verifySecret('x', 'nonsense'));
  assert.ok(!verifySecret('x', 'scrypt$aa$bb'));
});

test('the one-time code from publishing opens the portal exactly once', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { employerId, accessCode } = await publish(app);
  assert.ok(accessCode);
  const employer = app.store.getEmployer(employerId);
  assert.ok(employer);

  const session = app.access.authenticate(employer, 'one_time_code', accessCode);
  assert.equal(app.access.requireEmployer(session.token).id, employerId);

  // Reusing a consumed code fails.
  assert.throws(() => app.access.authenticate(employer, 'one_time_code', accessCode), /not valid/);
});

test('a wrong code is refused and counts against the attempt limit', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { employerId, accessCode } = await publish(app);
  const employer = app.store.getEmployer(employerId);
  assert.ok(employer && accessCode);

  for (let attempt = 0; attempt < app.config.maxOtpAttempts; attempt += 1) {
    assert.throws(() => app.access.authenticate(employer, 'one_time_code', '00000000'), /not valid/);
  }
  // The grant is now locked out even for the right code.
  assert.throws(() => app.access.authenticate(employer, 'one_time_code', accessCode), /not valid/);
});

test('a password keeps working, unlike a one-time code', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { employerId } = await publish(app);
  const employer = app.store.getEmployer(employerId);
  assert.ok(employer);

  app.agency.setEmployerPassword(employerId, 'zanzibar-2026');
  assert.equal(app.access.authenticate(employer, 'password', 'zanzibar-2026').employerId, employerId);
  assert.equal(app.access.authenticate(employer, 'password', 'zanzibar-2026').employerId, employerId);
  assert.throws(() => app.access.authenticate(employer, 'password', 'guess'), /not valid/);
});

test('short passwords are refused', async (t) => {
  const app = makeApp();
  t.after(() => app.close());
  const { employerId } = await publish(app);

  assert.throws(
    () => app.agency.setEmployerPassword(employerId, 'short'),
    (error: Error & { code?: string }) => error.code === 'weak_password',
  );
});

test('an expired OTP does not open the portal', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { employerId } = await publish(app);
  const employer = app.store.getEmployer(employerId);
  assert.ok(employer);

  const otp = app.access.issueOtp(employerId, 'email_otp', 'client@example.com');
  app.store.db
    .prepare(`UPDATE employer_access_grants SET expires_at = ? WHERE employer_id = ? AND kind = 'email_otp'`)
    .run('2020-01-01T00:00:00.000Z', employerId);

  assert.throws(() => app.access.authenticate(employer, 'email_otp', otp.secret), /not valid/);
});

test('resending access revokes the code the client was given before', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { employerId, accessCode } = await publish(app);
  const employer = app.store.getEmployer(employerId);
  assert.ok(employer && accessCode);

  const reissued = app.agency.resendAccess(employerId, 'one_time_code');
  assert.notEqual(reissued.secret, accessCode);
  assert.throws(() => app.access.authenticate(employer, 'one_time_code', accessCode), /not valid/);
  assert.equal(app.access.authenticate(employer, 'one_time_code', reissued.secret).employerId, employerId);
});

test('an OTP needs somewhere to send it', async (t) => {
  const app = makeApp();
  t.after(() => app.close());
  const { employerId } = await publish(app);

  assert.throws(
    () => app.agency.resendAccess(employerId, 'email_otp'),
    (error: Error & { code?: string }) => error.code === 'missing_destination',
  );
});

test('expired and revoked sessions stop working', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { employerId } = await publish(app);
  const live = app.access.startSession(employerId);
  assert.equal(app.access.requireEmployer(live.token).id, employerId);

  app.access.logout(live.token);
  assert.throws(() => app.access.requireEmployer(live.token), /session has expired|Authentication required/);

  const second = app.access.startSession(employerId);
  app.store.db.prepare('UPDATE employer_sessions SET expires_at = ?').run('2020-01-01T00:00:00.000Z');
  assert.throws(() => app.access.requireEmployer(second.token), /session has expired/);
  app.store.purgeExpiredSessions();
});

test('an employer token cannot be used as an applicant token', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { employerId } = await publish(app);
  const session = app.access.startSession(employerId);
  assert.throws(() => app.access.requireApplicantId(session.token), /session has expired|Authentication required/);
  assert.throws(() => app.access.requireEmployer(null), /Authentication required/);
});

test('signing in stamps the client as having opened their page', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { employerId, accessCode } = await publish(app);
  const employer = app.store.getEmployer(employerId);
  assert.ok(employer && accessCode);
  assert.equal(app.store.employerLastSeen(employerId), null);

  app.access.authenticate(employer, 'one_time_code', accessCode);
  assert.ok(app.store.employerLastSeen(employerId));
});
