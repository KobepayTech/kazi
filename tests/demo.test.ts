import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEMO_APPLICANT_PHONE,
  DEMO_EMPLOYER_ACCESS_CODE,
  DEMO_EMPLOYER_NAME,
  DEMO_EMPLOYER_PAGE_CODE,
  ensureDemoData,
} from '../src/demo.ts';
import { makeHarness } from './helpers.ts';

test('demo seed creates a full swipe deck and an active demo applicant', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const result = await ensureDemoData(kobe, 'staff_demo');
  assert.equal(result.createdJobs, 8);
  assert.equal(result.demoJobs, 8);
  assert.equal(result.feedCards, 8);
  assert.equal(result.applicantCreated, true);
  assert.equal(result.membershipActivated, true);
  assert.equal(result.applicantPhone, DEMO_APPLICANT_PHONE);
  assert.equal(result.demoEmployerLink, 'https://jobs.kobeos.test/e/DEMO01');
  assert.equal(result.demoEmployerAccessCode, DEMO_EMPLOYER_ACCESS_CODE);

  const demoEmployer = kobe.store.findEmployerByName(DEMO_EMPLOYER_NAME);
  assert.ok(demoEmployer);
  assert.equal(demoEmployer.accessCode, DEMO_EMPLOYER_PAGE_CODE);
  const session = kobe.access.authenticateEmployer(demoEmployer, 'access_code', DEMO_EMPLOYER_ACCESS_CODE);
  assert.equal(kobe.access.requireEmployer(session.token).id, demoEmployer.id);

  const applicant = kobe.store.getApplicantByPhone(DEMO_APPLICANT_PHONE);
  assert.ok(applicant);
  assert.equal(kobe.memberships.view(applicant.id).active, true);

  const titles = kobe.swipe.feed(applicant.id, 100).map((card) => card.title);
  assert.ok(titles.includes('Hotel Attendant'));
  assert.ok(titles.includes('Call Centre Agent'));
  assert.ok(titles.includes('Truck Driver'));
  assert.ok(titles.includes('Secondary School Teacher'));
  assert.ok(titles.includes('Shop Attendant'));
  assert.ok(titles.some((title) => /it support technician/i.test(title)));
});

test('demo seed is idempotent', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const first = await ensureDemoData(kobe, 'staff_demo');
  const second = await ensureDemoData(kobe, 'staff_demo');

  assert.equal(first.createdJobs, 8);
  assert.equal(second.createdJobs, 0);
  assert.equal(second.demoJobs, 8);
  assert.equal(second.feedCards, 8);
  assert.equal(second.demoEmployerLink, 'https://jobs.kobeos.test/e/DEMO01');
  assert.equal(second.demoEmployerAccessCode, '123456');
  assert.equal(kobe.store.listEmployers().filter((employer) => employer.name.endsWith('(Demo)')).length, 8);

  const demoEmployer = kobe.store.findEmployerByName(DEMO_EMPLOYER_NAME);
  assert.ok(demoEmployer);
  assert.equal(demoEmployer.accessCode, DEMO_EMPLOYER_PAGE_CODE);
  const session = kobe.access.authenticateEmployer(demoEmployer, 'access_code', DEMO_EMPLOYER_ACCESS_CODE);
  assert.equal(kobe.access.requireEmployer(session.token).id, demoEmployer.id);
});
