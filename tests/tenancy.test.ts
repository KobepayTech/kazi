import test from 'node:test';
import assert from 'node:assert/strict';
import { hashSecret, verifySecret } from '../src/services/access.ts';
import { applyTo, makeApplicant, makeHarness, publish } from './helpers.ts';

test('a fresh database bootstraps the first agency with its packages', (t) => {
  const { platform, kobe, close } = makeHarness();
  t.after(close);

  assert.equal(platform.defaultTenant.name, 'Soko Huru');
  assert.equal(platform.defaultTenant.slug, 'soko-huru');
  assert.deepEqual(
    kobe.memberships.plans().map((plan) => [plan.code, plan.priceTzs]),
    [['non_certificate', 15_000], ['certificate', 30_000], ['special_service', 50_000]],
  );
});

test('the agency key selects the tenant as well as authenticating it', (t) => {
  const { platform, close } = makeHarness();
  t.after(close);

  assert.equal(platform.tenantForApiKey('test-agency-key')?.tenant.slug, 'soko-huru');
  assert.equal(platform.tenantForApiKey('wrong-key'), null);
  assert.equal(platform.tenantForApiKey(null), null);
  assert.equal(platform.tenantForApiKey(''), null);
});

test('a second agency is a row, not a fork: no data crosses between tenants', async (t) => {
  const { platform, kobe, close } = makeHarness();
  t.after(close);

  const rival = platform.createTenant('Kazi Bora', 'kazi-bora', 'rival-key');

  const soko = await publish(kobe);
  const sokoApplicant = makeApplicant(kobe);
  applyTo(kobe, sokoApplicant.applicant.id, soko.job.id);

  const other = await publish(rival, { employerName: 'Mbeya Farms', text: 'Job title: Farm Supervisor\nLocation: Mbeya\nSalary: TSh 500,000 per month\nPositions: 2' });

  // Each tenant sees only its own clients, jobs and applications.
  assert.deepEqual(kobe.store.listEmployers().map((employer) => employer.name), ['Zanzibar Resort']);
  assert.deepEqual(rival.store.listEmployers().map((employer) => employer.name), ['Mbeya Farms']);
  assert.equal(kobe.agency.overview().length, 1);
  assert.equal(rival.agency.overview().length, 1);
  assert.equal(rival.store.getJob(soko.job.id), null);
  assert.equal(kobe.store.getJob(other.job.id), null);
  assert.equal(rival.store.getApplicant(sokoApplicant.applicant.id), null);

  // Each tenant gets its own packages and its own reference series.
  assert.equal(rival.memberships.plans().length, 3);
  rival.memberships.savePlan({
    code: 'non_certificate', name: 'Basic', priceTzs: 9_000, durationDays: 30,
    coversNonCertificateJobs: true, coversCertificateJobs: false, active: true,
  });
  assert.equal(rival.store.getPlan('non_certificate')?.priceTzs, 9_000);
  assert.equal(kobe.store.getPlan('non_certificate')?.priceTzs, 15_000);
  assert.match(other.job.reference, /^KB-JOB-/);
  assert.match(soko.job.reference, /^SH-JOB-/);
});

test('a session from one tenant is not a session in another', async (t) => {
  const { platform, kobe, close } = makeHarness();
  t.after(close);

  const rival = platform.createTenant('Kazi Bora', 'kazi-bora', 'rival-key');
  const { token } = makeApplicant(kobe);

  assert.equal(platform.sessionContext(token)?.context.tenant.slug, 'soko-huru');
  assert.throws(() => rival.access.requireApplicantId(token), /Authentication required|session has expired/);
});

test('the agency admin can change a package price', (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const updated = kobe.memberships.savePlan({
    code: 'non_certificate',
    name: 'Jobs without certificates',
    priceTzs: 20_000,
    durationDays: 60,
    coversNonCertificateJobs: true,
    coversCertificateJobs: false,
    active: true,
  });
  assert.equal(updated.priceTzs, 20_000);
  assert.equal(kobe.memberships.plans()[0]?.priceTzs, 20_000);

  assert.throws(
    () => kobe.memberships.savePlan({ ...updated, durationDays: 0 }),
    (error: Error & { code?: string }) => error.code === 'invalid_duration',
  );
});

// ------------------------------------------------------------- payments

test('pay, submit the reference, agency confirms, membership starts', (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { applicant } = makeApplicant(kobe, { planCode: null });
  const { payment, membership } = kobe.memberships.submitPayment({
    applicantId: applicant.id,
    planCode: 'certificate',
    amountTzs: 30_000,
    reference: 'MPESA-ABC123',
  });

  assert.equal(payment.status, 'submitted');
  assert.equal(membership.status, 'pending_payment');
  assert.equal(kobe.memberships.view(applicant.id).active, false);
  assert.equal(kobe.memberships.pendingPayments().length, 1);

  const confirmed = kobe.memberships.confirmPayment(payment.id, 'staff_amina');
  assert.equal(confirmed.payment.status, 'confirmed');
  assert.equal(confirmed.membership.status, 'active');

  const view = kobe.memberships.view(applicant.id);
  assert.equal(view.active, true);
  assert.equal(view.plan?.code, 'certificate');
  assert.equal(view.daysRemaining, 90);
  assert.equal(kobe.memberships.pendingPayments().length, 0);
});

test('an underpayment cannot be confirmed', (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { applicant } = makeApplicant(kobe, { planCode: null });
  const { payment } = kobe.memberships.submitPayment({
    applicantId: applicant.id, planCode: 'certificate', amountTzs: 15_000, reference: 'MPESA-SHORT',
  });

  assert.throws(
    () => kobe.memberships.confirmPayment(payment.id, 'staff_amina'),
    (error: Error & { code?: string }) => error.code === 'underpaid' && /30,000/.test(error.message),
  );
  assert.equal(kobe.memberships.view(applicant.id).active, false);
});

test('the same transaction reference cannot be claimed twice', (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const first = makeApplicant(kobe, { planCode: null });
  const second = makeApplicant(kobe, { planCode: null });
  kobe.memberships.submitPayment({
    applicantId: first.applicant.id, planCode: 'non_certificate', amountTzs: 15_000, reference: 'MPESA-DUP',
  });

  assert.throws(
    () => kobe.memberships.submitPayment({
      applicantId: second.applicant.id, planCode: 'non_certificate', amountTzs: 15_000, reference: 'MPESA-DUP',
    }),
    (error: Error & { code?: string }) => error.code === 'duplicate_reference',
  );
});

test('a rejected payment leaves the membership pending and tells the applicant', (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { applicant } = makeApplicant(kobe, { planCode: null });
  const { payment } = kobe.memberships.submitPayment({
    applicantId: applicant.id, planCode: 'non_certificate', amountTzs: 15_000, reference: 'MPESA-BAD',
  });

  const rejected = kobe.memberships.rejectPayment(payment.id, 'staff_amina', 'No such transaction');
  assert.equal(rejected.status, 'rejected');
  assert.equal(kobe.memberships.view(applicant.id).active, false);
  assert.ok(kobe.bus.replay('applicant', applicant.id, 0).some((event) => event.type === 'payment_rejected'));
});

test('a lapsed membership stops working', (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { applicant } = makeApplicant(kobe);
  const membership = kobe.store.getActiveMembership(applicant.id);
  assert.ok(membership);

  kobe.store.db.prepare('UPDATE memberships SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', membership.id);
  assert.equal(kobe.memberships.expireLapsed(), 1);
  assert.equal(kobe.store.getActiveMembership(applicant.id), null);
});

// --------------------------------------------------------- employer access

test('secrets are stored salted, never in the clear', () => {
  const stored = hashSecret('correct horse battery');
  assert.match(stored, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.ok(verifySecret('correct horse battery', stored));
  assert.ok(!verifySecret('wrong', stored));
  assert.ok(!verifySecret('x', 'nonsense'));
  assert.notEqual(hashSecret('same'), hashSecret('same'));
});

test('the short link names the client; the access code proves it is them', async (t) => {
  const { platform, kobe, close } = makeHarness();
  t.after(close);

  const { employerId, employerLink, accessCode } = await publish(kobe);
  assert.ok(accessCode);

  const code = employerLink.split('/e/')[1] ?? '';
  const employer = platform.store.findEmployerByAccessCode(code);
  assert.equal(employer?.id, employerId);

  // Holding the link is not enough on its own.
  assert.throws(() => kobe.access.authenticateEmployer(employer!, 'access_code', '000000'), /not valid/);
  const session = kobe.access.authenticateEmployer(employer!, 'access_code', accessCode);
  assert.equal(kobe.access.requireEmployer(session.token).id, employerId);
});

test('the standing access code keeps working; an OTP is consumed once', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { employerId, accessCode } = await publish(kobe, { contactPhone: '+255777000111' });
  const employer = kobe.store.getEmployer(employerId);
  assert.ok(employer && accessCode);

  assert.ok(kobe.access.authenticateEmployer(employer, 'access_code', accessCode).token);
  assert.ok(kobe.access.authenticateEmployer(employer, 'access_code', accessCode).token);

  const otp = kobe.access.issueOtp(employer, 'phone_otp');
  assert.ok(kobe.access.authenticateEmployer(employer, 'phone_otp', otp.secret).token);
  assert.throws(() => kobe.access.authenticateEmployer(employer, 'phone_otp', otp.secret), /not valid/);
});

test('an OTP needs a contact to send it to', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { employerId } = await publish(kobe);
  const employer = kobe.store.getEmployer(employerId);
  assert.ok(employer);
  assert.throws(
    () => kobe.access.issueOtp(employer, 'email_otp'),
    (error: Error & { code?: string }) => error.code === 'missing_destination',
  );
});

test('guessing an access code locks the grant out', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { employerId, accessCode } = await publish(kobe);
  const employer = kobe.store.getEmployer(employerId);
  assert.ok(employer && accessCode);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.throws(() => kobe.access.authenticateEmployer(employer, 'access_code', '000000'), /not valid/);
  }
  assert.throws(() => kobe.access.authenticateEmployer(employer, 'access_code', accessCode), /not valid/);
});

test('resending access revokes the code the client had before', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { employerId, accessCode } = await publish(kobe);
  const employer = kobe.store.getEmployer(employerId);
  assert.ok(employer && accessCode);

  const reissued = kobe.agency.resendAccess(employerId);
  assert.notEqual(reissued.secret, accessCode);
  assert.throws(() => kobe.access.authenticateEmployer(employer, 'access_code', accessCode), /not valid/);
  assert.ok(kobe.access.authenticateEmployer(employer, 'access_code', reissued.secret).token);
  // The link itself does not change when the code is rotated.
  assert.equal(reissued.employerLink.split('/e/')[1], employer.accessCode);
});

test('signing in stamps the client as having opened their page', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { employerId, accessCode } = await publish(kobe);
  const employer = kobe.store.getEmployer(employerId);
  assert.ok(employer && accessCode);
  assert.equal(employer.lastSeenAt, null);

  kobe.access.authenticateEmployer(employer, 'access_code', accessCode);
  assert.ok(kobe.store.getEmployer(employerId)?.lastSeenAt);
});

test('an employer token is not an applicant token, and vice versa', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { employerId } = await publish(kobe);
  const employerToken = kobe.access.startEmployerSession(employerId).token;
  const { token: applicantToken } = makeApplicant(kobe);

  assert.throws(() => kobe.access.requireApplicantId(employerToken), /Authentication required/);
  assert.throws(() => kobe.access.requireEmployer(applicantToken), /Authentication required/);
  assert.throws(() => kobe.access.requireEmployer(null), /Authentication required/);
});

test('logging out ends the session', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { employerId } = await publish(kobe);
  const session = kobe.access.startEmployerSession(employerId);
  assert.equal(kobe.access.requireEmployer(session.token).id, employerId);

  kobe.access.logout(session.token);
  assert.throws(() => kobe.access.requireEmployer(session.token), /session has expired|Authentication required/);
});
