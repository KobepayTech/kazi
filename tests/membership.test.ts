import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PACKAGES,
  checkMembership,
  daysUntilExpiry,
  expiryFor,
  isActive,
  packageCovers,
  remainingApplications,
  renewalReminderDue,
} from '../src/domain/membership.ts';
import type { Membership, MembershipPackage } from '../src/domain/types.ts';
import { makeApp, makeApplicant } from './helpers.ts';

const nonCertificate = DEFAULT_PACKAGES.find((pkg) => pkg.code === 'non_certificate') as MembershipPackage;
const certificate = DEFAULT_PACKAGES.find((pkg) => pkg.code === 'certificate') as MembershipPackage;
const special = DEFAULT_PACKAGES.find((pkg) => pkg.code === 'special_service') as MembershipPackage;

function membership(overrides: Partial<Membership> = {}): Membership {
  return {
    id: 'mem_1',
    applicantId: 'app_1',
    packageCode: 'non_certificate',
    status: 'active',
    paidAmountTzs: 15_000,
    paymentReference: 'MPESA-1',
    activatedAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-11-01T00:00:00.000Z',
    applicationsUsed: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

test("Soko Huru's three published packages carry the advertised prices", () => {
  assert.equal(nonCertificate.priceTzs, 15_000);
  assert.equal(certificate.priceTzs, 30_000);
  assert.equal(special.priceTzs, 50_000);
});

test('the cheap package covers non-certificate jobs only', () => {
  assert.ok(packageCovers(nonCertificate, { certificateRequired: false, category: 'hospitality' }));
  assert.ok(!packageCovers(nonCertificate, { certificateRequired: true, category: 'teaching' }));
  assert.ok(packageCovers(certificate, { certificateRequired: true, category: 'teaching' }));
});

test('applying to a certificate job on the cheap package is refused with the upgrade named', () => {
  const check = checkMembership(
    membership(),
    nonCertificate,
    { certificateRequired: true, category: 'teaching' },
    DEFAULT_PACKAGES,
  );
  assert.equal(check.ok, false);
  if (check.ok) return;
  assert.equal(check.code, 'package_excludes_certificate_jobs');
  // The cheapest package that would work, not just any upgrade.
  assert.equal(check.upgradeTo?.code, 'certificate');
});

test('an expired or unpaid membership cannot apply', () => {
  const expired = checkMembership(
    membership({ expiresAt: '2026-01-01T00:00:00.000Z' }),
    nonCertificate,
    { certificateRequired: false, category: 'hospitality' },
    DEFAULT_PACKAGES,
    new Date('2026-08-10'),
  );
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal(expired.code, 'membership_expired');

  const pending = checkMembership(
    membership({ status: 'pending_payment' }),
    nonCertificate,
    { certificateRequired: false, category: 'hospitality' },
    DEFAULT_PACKAGES,
  );
  assert.equal(pending.ok, false);
  if (!pending.ok) assert.equal(pending.code, 'membership_pending_payment');
});

test('no membership at all points to the cheapest package that would cover the job', () => {
  const check = checkMembership(null, null, { certificateRequired: false, category: 'hospitality' }, DEFAULT_PACKAGES);
  assert.equal(check.ok, false);
  if (check.ok) return;
  assert.equal(check.code, 'no_membership');
  assert.equal(check.upgradeTo?.code, 'non_certificate');
});

test('application limits are enforced, and the unlimited package is offered', () => {
  const used = membership({ applicationsUsed: nonCertificate.applicationLimit ?? 0 });
  assert.equal(remainingApplications(used, nonCertificate), 0);

  const check = checkMembership(used, nonCertificate, { certificateRequired: false, category: 'hospitality' }, DEFAULT_PACKAGES);
  assert.equal(check.ok, false);
  if (!check.ok) {
    assert.equal(check.code, 'application_limit_reached');
    assert.equal(check.upgradeTo?.code, 'special_service');
  }
  assert.equal(remainingApplications(membership(), special), null);
});

test('a package restricted to categories only covers those categories', () => {
  const hospitalityOnly: MembershipPackage = { ...nonCertificate, code: 'hospitality_only', categories: ['hospitality'] };
  assert.ok(packageCovers(hospitalityOnly, { certificateRequired: false, category: 'hospitality' }));
  assert.ok(!packageCovers(hospitalityOnly, { certificateRequired: false, category: 'driving' }));
});

test('expiry is the activation date plus the package duration', () => {
  const expires = expiryFor(new Date('2026-08-01T00:00:00.000Z'), nonCertificate);
  assert.equal(expires, '2026-10-30T00:00:00.000Z');
  assert.equal(daysUntilExpiry(membership(), new Date('2026-10-25T00:00:00.000Z')), 7);
});

test('renewal reminders fire in the last week only', () => {
  assert.ok(renewalReminderDue(membership(), 7, new Date('2026-10-28T00:00:00.000Z')));
  assert.ok(!renewalReminderDue(membership(), 7, new Date('2026-09-01T00:00:00.000Z')));
  assert.ok(!renewalReminderDue(membership({ status: 'expired' }), 7, new Date('2026-10-28T00:00:00.000Z')));
});

test('a membership only goes live once the payment is confirmed', () => {
  const app = makeApp();
  const { applicant } = makeApplicant(app, { packageCode: null });

  const pending = app.memberships.purchase(applicant.id, 'non_certificate');
  assert.equal(pending.status, 'pending_payment');
  assert.equal(app.memberships.view(applicant.id).active, false);

  const active = app.memberships.confirmPayment(pending.id, 15_000, 'MPESA-XYZ');
  assert.equal(active.status, 'active');
  assert.ok(isActive(active));
  assert.equal(app.memberships.view(applicant.id).applicationsRemaining, 30);

  app.close();
});

test('an underpayment is refused with the shortfall visible', () => {
  const app = makeApp();
  const { applicant } = makeApplicant(app, { packageCode: null });
  const pending = app.memberships.purchase(applicant.id, 'certificate');

  assert.throws(
    () => app.memberships.confirmPayment(pending.id, 15_000, 'MPESA-SHORT'),
    (error: Error & { code?: string }) => error.code === 'underpaid' && /30,000/.test(error.message),
  );
  app.close();
});

test('lapsed memberships are swept to expired', () => {
  const app = makeApp();
  const { applicant } = makeApplicant(app, { packageCode: null });
  const pending = app.memberships.purchase(applicant.id, 'non_certificate');
  app.memberships.confirmPayment(pending.id, 15_000, 'MPESA-1');

  app.store.db.prepare('UPDATE memberships SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', pending.id);
  assert.equal(app.memberships.expireLapsed(), 1);
  assert.equal(app.store.getActiveMembership(applicant.id), null);
  app.close();
});

test('renewal reminders are raised for the right applicants', () => {
  const app = makeApp();
  const { applicant } = makeApplicant(app);
  const active = app.store.getActiveMembership(applicant.id);
  assert.ok(active);

  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
  app.store.db.prepare('UPDATE memberships SET expires_at = ? WHERE id = ?').run(soon, active.id);

  const reminders = app.memberships.sendRenewalReminders(7);
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0]?.applicantId, applicant.id);

  const events = app.bus.replay('applicant', applicant.id, 0);
  assert.ok(events.some((event) => event.type === 'membership_renewal_due'));
  app.close();
});
