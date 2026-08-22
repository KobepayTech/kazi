import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createServer } from '../src/http/server.ts';
import { makeApplicant, makeHarness, publish } from './helpers.ts';
import type { TenantContext } from '../src/app.ts';

function submission(employerId: string, overrides: Record<string, unknown> = {}) {
  return {
    employerId,
    title: 'Night Auditor',
    location: 'Zanzibar',
    category: 'hospitality' as const,
    positions: 2,
    salaryAmountMin: 300,
    salaryAmountMax: null,
    salaryCurrency: 'USD' as const,
    salaryPeriod: 'month' as const,
    salaryPlusTips: false,
    description: 'Overnight front desk cover for a beach resort.',
    responsibilities: ['Close the daily accounts', 'Handle late check-ins'],
    requirements: ['Basic bookkeeping', 'English required'],
    applicationDeadline: null,
    accommodationProvided: true,
    languages: ['English'],
    experienceNote: '1 year front desk experience preferred',
    certificateRequired: false,
    immediateStart: true,
    ...overrides,
  };
}

test('a client can type a vacancy, and it waits for the agency', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { employerId } = await publish(kobe);
  const draft = kobe.intake.submitFromEmployer(submission(employerId));

  assert.equal(draft.status, 'extracted');
  assert.equal(draft.intakeChannel, 'employer_form');
  assert.equal(draft.employerId, employerId);
  assert.equal(draft.extraction.extractor, 'employer-form-v1');
  assert.equal(draft.extraction.job.title, 'Night Auditor');
  assert.equal(draft.extraction.job.employerName, 'Zanzibar Resort');
  assert.equal(draft.extraction.job.salary?.monthlyTzs, 780_000);
  // Nothing was guessed, so nothing is flagged as uncertain.
  assert.deepEqual(draft.extraction.needsReview, []);

  // Crucially: it is not live yet.
  assert.equal(kobe.store.listPublishedJobs().length, 1, 'only the agency-published job is live');
  assert.equal(kobe.swipe.feed(makeApplicant(kobe).applicant.id).length, 1);
});

test('the typed vacancy lands in the same review queue as an uploaded poster', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { employerId } = await publish(kobe);
  await kobe.intake.uploadPost({
    channel: 'whatsapp_text',
    text: 'Job title: Cleaner\nLocation: Zanzibar\nSalary: TSh 300,000 per month',
    employerName: 'Zanzibar Resort',
    staffId: 'staff_amina',
  });
  kobe.intake.submitFromEmployer(submission(employerId));

  const queue = kobe.agency.reviewQueue();
  assert.equal(queue.length, 2);
  assert.deepEqual(
    queue.map((item) => item.source).sort(),
    ['agency_upload', 'employer_form'],
  );
  const typed = queue.find((item) => item.source === 'employer_form');
  assert.equal(typed?.employerName, 'Zanzibar Resort');
});

test('staff publishing it attributes the job to the right client automatically', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { employerId, employerLink } = await publish(kobe);
  const draft = kobe.intake.submitFromEmployer(submission(employerId));

  // Staff publish without naming an employer; the draft already knows.
  const result = kobe.intake.publishDraft(draft.id, { staffId: 'staff_amina' });

  assert.equal(result.employerId, employerId);
  assert.equal(result.employerName, 'Zanzibar Resort');
  assert.equal(result.employerLink, employerLink, 'an existing client keeps its link');
  assert.equal(result.accessCode, null, 'and does not get a new access code');
  assert.equal(result.job.status, 'published');
  assert.equal(result.job.intakeChannel, 'employer_form');
  assert.deepEqual(result.job.responsibilities, ['Close the daily accounts', 'Handle late check-ins']);
  assert.equal(result.job.accommodationProvided, true);

  // Now it reaches applicants.
  const { applicant } = makeApplicant(kobe);
  const titles = kobe.swipe.feed(applicant.id).map((card) => card.title);
  assert.ok(titles.includes('Night Auditor'));
});

test('staff can still correct a typed vacancy before publishing it', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { employerId } = await publish(kobe);
  const draft = kobe.intake.submitFromEmployer(submission(employerId, { title: 'nite auditer' }));

  kobe.intake.saveCorrections(draft.id, { title: 'Night Auditor', positions: 3 }, null);
  const { job } = kobe.intake.publishDraft(draft.id, { staffId: 'staff_amina' });

  assert.equal(job.title, 'Night Auditor');
  assert.equal(job.positions, 3);
});

test('the agency dashboard is told when a client sends something in', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { employerId } = await publish(kobe);
  const seen: string[] = [];
  kobe.bus.subscribe('agency', 'agency', (event) => seen.push(event.type));

  kobe.intake.submitFromEmployer(submission(employerId));
  assert.deepEqual(seen, ['job_submitted_by_employer']);
});

test('a client cannot flood the review queue', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { employerId } = await publish(kobe);
  for (let index = 0; index < 20; index += 1) {
    kobe.intake.submitFromEmployer(submission(employerId, { title: `Role ${index}` }));
  }
  assert.throws(
    () => kobe.intake.submitFromEmployer(submission(employerId)),
    (error: Error & { code?: string }) => error.code === 'too_many_pending',
  );
});

test('a client only sees their own submissions', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const zanzibar = await publish(kobe);
  const school = await publish(kobe, {
    employerName: 'Mwanga Private School',
    text: 'Job title: Teacher\nLocation: Arusha\nSalary: TSh 700,000 per month\nPositions: 2',
  });

  kobe.intake.submitFromEmployer(submission(zanzibar.employerId));
  assert.equal(kobe.employer.submissions(zanzibar.employerId).length, 1);
  assert.equal(kobe.employer.submissions(school.employerId).length, 0);

  const row = kobe.employer.submissions(zanzibar.employerId)[0];
  assert.equal(row?.title, 'Night Auditor');
  assert.equal(row?.status, 'extracted');
  assert.equal(row?.jobId, null);
});

test('a published submission shows as live to the client', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { employerId } = await publish(kobe);
  const draft = kobe.intake.submitFromEmployer(submission(employerId));
  const { job } = kobe.intake.publishDraft(draft.id, { staffId: 'staff_amina' });

  const row = kobe.employer.submissions(employerId)[0];
  assert.equal(row?.status, 'published');
  assert.equal(row?.jobId, job.id);
});

// ------------------------------------------------------------------- over HTTP

async function serve(t: { after(fn: () => void): void }): Promise<{ base: string; kobe: TenantContext }> {
  const harness = makeHarness();
  const server = createServer(harness.platform);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  t.after(() => {
    server.close();
    harness.close();
  });
  return { base: `http://127.0.0.1:${port}`, kobe: harness.kobe };
}

async function call(base: string, path: string, options: { token?: string; key?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.key) headers['x-agency-key'] = options.key;
  const response = await fetch(`${base}${path}`, {
    method: options.body === undefined ? 'GET' : 'POST',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
}

test('a signed-in client can post a vacancy over HTTP', async (t) => {
  const { base, kobe } = await serve(t);
  const { employerId } = await publish(kobe);
  const token = kobe.access.startEmployerSession(employerId).token;

  const posted = await call(base, '/api/employer/jobs', {
    token,
    body: {
      title: 'Night Auditor',
      location: 'Zanzibar',
      category: 'hospitality',
      positions: 2,
      salaryAmountMin: 300,
      salaryCurrency: 'USD',
      salaryPeriod: 'month',
      accommodationProvided: true,
      requirements: ['Basic bookkeeping'],
    },
  });
  assert.equal(posted.status, 200);
  assert.match(String(posted.body.message), /agency/i);

  const submissions = await call(base, '/api/employer/submissions', { token });
  const rows = (submissions.body as unknown as { submissions: { title: string; status: string }[] }).submissions;
  assert.equal(rows[0]?.title, 'Night Auditor');
  assert.equal(rows[0]?.status, 'extracted');

  // It shows up in the agency queue, marked as client-typed.
  const queue = await call(base, '/api/agency/queue', { key: 'test-agency-key' });
  const items = (queue.body as unknown as { queue: { source: string }[] }).queue;
  assert.equal(items.length, 1);
  assert.equal(items[0]?.source, 'employer_form');
});

test('posting a vacancy needs a signed-in client, and validates its input', async (t) => {
  const { base, kobe } = await serve(t);
  const { employerId } = await publish(kobe);
  const token = kobe.access.startEmployerSession(employerId).token;

  assert.equal((await call(base, '/api/employer/jobs', { body: { title: 'x' } })).status, 401);

  const missingTitle = await call(base, '/api/employer/jobs', { token, body: { location: 'Zanzibar' } });
  assert.equal(missingTitle.status, 400);
  assert.equal((missingTitle.body.error as { code: string }).code, 'missing_field');

  const badCategory = await call(base, '/api/employer/jobs', {
    token, body: { title: 'Chef', location: 'Zanzibar', category: 'wizardry' },
  });
  assert.equal((badCategory.body.error as { code: string }).code, 'invalid_category');

  const badCurrency = await call(base, '/api/employer/jobs', {
    token, body: { title: 'Chef', location: 'Zanzibar', category: 'hospitality', salaryCurrency: 'GBP' },
  });
  assert.equal((badCurrency.body.error as { code: string }).code, 'invalid_currency');

  const badPositions = await call(base, '/api/employer/jobs', {
    token, body: { title: 'Chef', location: 'Zanzibar', category: 'hospitality', positions: 0 },
  });
  assert.equal((badPositions.body.error as { code: string }).code, 'invalid_positions');
});

test('a client cannot post a vacancy for another client', async (t) => {
  const { base, kobe } = await serve(t);
  const zanzibar = await publish(kobe);
  const school = await publish(kobe, {
    employerName: 'Mwanga Private School',
    text: 'Job title: Teacher\nLocation: Arusha\nSalary: TSh 700,000 per month\nPositions: 2',
  });
  const token = kobe.access.startEmployerSession(school.employerId).token;

  // employerId comes from the session, never from the request body.
  await call(base, '/api/employer/jobs', {
    token,
    body: { title: 'Sneaky Post', location: 'Zanzibar', category: 'hospitality', employerId: zanzibar.employerId },
  });

  assert.equal(kobe.employer.submissions(zanzibar.employerId).length, 0);
  assert.equal(kobe.employer.submissions(school.employerId).length, 1);
});
