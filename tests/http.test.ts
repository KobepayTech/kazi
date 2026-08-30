import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Platform } from '../src/app.ts';
import { createServer } from '../src/http/server.ts';
import { applyTo, makeApplicant, makeHarness, publish, type Harness } from './helpers.ts';

type Body = Record<string, unknown>;

async function listen(platform: Platform): Promise<{ base: string; server: Server }> {
  const server = createServer(platform);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, server };
}

async function call(
  base: string,
  path: string,
  options: { method?: string; token?: string; key?: string; body?: unknown } = {},
): Promise<{ status: number; body: Body }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.key) headers['x-agency-key'] = options.key;
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: response.status, body: (await response.json().catch(() => ({}))) as Body };
}

async function serve(t: { after(fn: () => void): void }): Promise<Harness & { base: string }> {
  const harness = makeHarness();
  const { base, server } = await listen(harness.platform);
  t.after(() => {
    server.close();
    harness.close();
  });
  return { ...harness, base };
}

const KEY = 'test-agency-key';

test('the whole MVP loop runs over HTTP', async (t) => {
  const { base, kobe } = await serve(t);

  // 1. The agency uploads the post it already sent out.
  const upload = await call(base, '/api/agency/posts', {
    key: KEY,
    body: {
      channel: 'whatsapp_text',
      employerName: 'Zanzibar Resort',
      text: [
        'AJIRA EXCLUSIVE - SOKO HURU',
        'We require eight female hotel attendants.',
        'Location: Zanzibar',
        'Salary: USD 200 plus tips',
        'Accommodation provided',
        'English required',
        'Ready to start immediately',
      ].join('\n'),
    },
  });
  assert.equal(upload.status, 200);
  const draft = upload.body.draft as { id: string };
  const extraction = upload.body.extraction as { job: { title: string; positions: number } };
  assert.equal(extraction.job.title, 'Hotel Attendant');
  assert.equal(extraction.job.positions, 8);

  // 2. Staff correct a field and publish.
  assert.equal(
    (await call(base, `/api/agency/drafts/${draft.id}`, {
      method: 'PATCH', key: KEY, body: { corrections: { positions: 8 } },
    })).status,
    200,
  );
  const publishResponse = await call(base, `/api/agency/drafts/${draft.id}/publish`, {
    key: KEY,
    body: { employerName: 'Zanzibar Resort', contactPhone: '+255777000111' },
  });
  assert.equal(publishResponse.status, 200);
  const published = publishResponse.body as unknown as {
    job: { id: string };
    employerLink: string;
    accessCode: { secret: string };
  };
  const code = published.employerLink.split('/e/')[1] ?? '';
  assert.match(code, /^[0-9A-Z]{6}$/);

  // 3. An applicant registers; KobeOS writes their CV and hands back a token.
  const registration = await call(base, '/api/applicants/register', {
    body: {
      fullName: 'Neema Joseph',
      phone: '+255711000900',
      location: 'Dar es Salaam',
      categories: ['hospitality'],
      experienceYears: 2,
      skills: ['Housekeeping'],
      languages: ['English', 'Swahili'],
      willingToRelocate: true,
    },
  });
  assert.equal(registration.status, 200);
  const registered = registration.body as unknown as {
    applicant: { id: string };
    cv: { headline: string };
    session: { token: string };
  };
  const applicantId = registered.applicant.id;
  const applicantToken = registered.session.token;
  assert.match(registered.cv.headline, /hospitality/i);

  // 4. They pay; the agency confirms.
  const payment = await call(base, `/api/applicants/${applicantId}/payments`, {
    token: applicantToken,
    body: { planCode: 'non_certificate', amountTzs: 15_000, reference: 'MPESA-HTTP-1' },
  });
  assert.equal(payment.status, 200);
  const paymentId = (payment.body as unknown as { payment: { id: string } }).payment.id;

  const blocked = await call(base, `/api/applicants/${applicantId}/swipes`, {
    token: applicantToken,
    body: { jobId: published.job.id, direction: 'right', confirmed: true },
  });
  assert.equal((blocked.body as unknown as { code: string }).code, 'membership_pending_payment');

  assert.equal((await call(base, `/api/agency/payments/${paymentId}/confirm`, { key: KEY, body: {} })).status, 200);

  // 5. The deck, the confirmation prompt, then the application.
  const feed = await call(base, `/api/applicants/${applicantId}/feed`, { token: applicantToken });
  const cards = (feed.body as unknown as { cards: { jobId: string; title: string }[] }).cards;
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.title, 'Hotel Attendant');

  const prompt = await call(base, `/api/applicants/${applicantId}/swipes`, {
    token: applicantToken,
    body: { jobId: published.job.id, direction: 'right' },
  });
  assert.equal((prompt.body as unknown as { result: string }).result, 'confirm_required');
  assert.equal(kobe.store.listApplicationsForApplicant(applicantId).length, 0);

  const applied = await call(base, `/api/applicants/${applicantId}/swipes`, {
    token: applicantToken,
    body: { jobId: published.job.id, direction: 'right', confirmed: true },
  });
  const outcome = applied.body as unknown as {
    result: string;
    confirmation: { applicationNumber: string; company: string };
    application: { id: string };
  };
  assert.equal(outcome.result, 'applied');
  assert.equal(outcome.confirmation.company, 'Zanzibar Resort');

  // 6. The employer opens their private link and signs in with the code.
  assert.equal((await call(base, `/api/e/${code}`)).status, 200);
  const login = await call(base, `/api/e/${code}/login`, {
    body: { kind: 'access_code', secret: published.accessCode.secret },
  });
  assert.equal(login.status, 200);
  const employerToken = (login.body as unknown as { token: string }).token;

  const dashboard = await call(base, '/api/employer/dashboard', { token: employerToken });
  const totals = (dashboard.body as unknown as { totals: { applications: number; newApplications: number } }).totals;
  assert.equal(totals.applications, 1);
  assert.equal(totals.newApplications, 1);

  // 7. Opening the CV marks them viewed; shortlisting reaches the applicant.
  const dossier = await call(base, `/api/employer/candidates/${outcome.application.id}`, { token: employerToken });
  assert.equal((dossier.body as unknown as { statusLabel: string }).statusLabel, 'Viewed');
  assert.match((dossier.body as unknown as { cvText: string }).cvText, /NEEMA JOSEPH/);

  assert.equal(
    (await call(base, `/api/employer/candidates/${outcome.application.id}/status`, {
      token: employerToken, body: { status: 'shortlisted' },
    })).status,
    200,
  );

  const tracker = await call(base, `/api/applicants/${applicantId}/applications`, { token: applicantToken });
  const tracked = (tracker.body as unknown as { applications: { statusLabel: string }[] }).applications;
  assert.equal(tracked[0]?.statusLabel, 'Shortlisted');
});

test('the agency API refuses a missing or wrong key', async (t) => {
  const { base } = await serve(t);
  assert.equal((await call(base, '/api/agency/overview')).status, 401);
  assert.equal((await call(base, '/api/agency/overview', { key: 'wrong' })).status, 401);
  assert.equal((await call(base, '/api/agency/overview', { key: KEY })).status, 200);
});

test('subscription paywall locks the deck and the agency can see subscriber status', async (t) => {
  const { base, kobe } = await serve(t);
  const published = await publish(kobe);

  const registration = await call(base, '/api/applicants/register', {
    body: {
      fullName: 'Paywall Test',
      phone: '+255711002222',
      location: 'Dar es Salaam',
      categories: ['hospitality'],
      experienceYears: 1,
      skills: ['Customer service'],
      languages: ['Swahili'],
      willingToRelocate: true,
    },
  });
  const registered = registration.body as unknown as {
    applicant: { id: string };
    session: { token: string };
  };

  const locked = await call(base, `/api/applicants/${registered.applicant.id}/feed`, {
    token: registered.session.token,
  });
  assert.equal((locked.body as unknown as { cards: unknown[] }).cards.length, 0);
  assert.equal((locked.body as unknown as { paywall: { required: boolean } }).paywall.required, true);

  const before = await call(base, '/api/agency/subscribers', { key: KEY });
  const unsubscribed = (before.body as unknown as {
    subscribers: { applicant: { id: string }; status: string }[];
  }).subscribers.find((entry) => entry.applicant.id === registered.applicant.id);
  assert.equal(unsubscribed?.status, 'unsubscribed');

  const payment = await call(base, `/api/applicants/${registered.applicant.id}/payments`, {
    token: registered.session.token,
    body: { planCode: 'non_certificate', amountTzs: 15_000, reference: 'PAYWALL-TEST-1' },
  });
  const paymentId = (payment.body as unknown as { payment: { id: string } }).payment.id;

  const pendingFeed = await call(base, `/api/applicants/${registered.applicant.id}/feed`, {
    token: registered.session.token,
  });
  assert.equal((pendingFeed.body as unknown as { cards: unknown[] }).cards.length, 0);
  assert.equal(
    (pendingFeed.body as unknown as { paywall: { membership: { pendingPayment: { reference: string } } } })
      .paywall.membership.pendingPayment.reference,
    'PAYWALL-TEST-1',
  );

  const pendingAdmin = await call(base, '/api/agency/subscribers', { key: KEY });
  const pending = (pendingAdmin.body as unknown as {
    subscribers: { applicant: { id: string }; status: string }[];
  }).subscribers.find((entry) => entry.applicant.id === registered.applicant.id);
  assert.equal(pending?.status, 'pending_payment');

  await call(base, `/api/agency/payments/${paymentId}/confirm`, { key: KEY, body: {} });

  const unlocked = await call(base, `/api/applicants/${registered.applicant.id}/feed`, {
    token: registered.session.token,
  });
  assert.equal((unlocked.body as unknown as { paywall: null }).paywall, null);
  const cards = (unlocked.body as unknown as { cards: { jobId: string }[] }).cards;
  assert.equal(cards.some((card) => card.jobId === published.job.id), true);

  const after = await call(base, '/api/agency/subscribers', { key: KEY });
  const active = (after.body as unknown as {
    summary: { active: number };
    subscribers: { applicant: { id: string }; status: string }[];
  });
  assert.equal(active.subscribers.find((entry) => entry.applicant.id === registered.applicant.id)?.status, 'active');
  assert.ok(active.summary.active >= 1);
});

test('employer endpoints need a session and never leak another client', async (t) => {
  const { base, kobe } = await serve(t);

  const zanzibar = await publish(kobe);
  const school = await publish(kobe, {
    employerName: 'Mwanga Private School',
    text: 'Job title: Teacher\nLocation: Arusha\nSalary: TSh 700,000 per month\nPositions: 2',
  });
  const { applicant } = makeApplicant(kobe);
  const outcome = applyTo(kobe, applicant.id, zanzibar.job.id);
  assert.equal(outcome.result, 'applied');
  if (outcome.result !== 'applied') return;

  assert.equal((await call(base, '/api/employer/dashboard')).status, 401);
  assert.equal((await call(base, '/api/employer/dashboard', { token: 'made-up' })).status, 401);

  const schoolToken = kobe.access.startEmployerSession(school.employerId).token;
  assert.equal(
    (await call(base, `/api/employer/candidates/${outcome.application.id}`, { token: schoolToken })).status,
    404,
  );
});

test('a bad code says the same thing for a real link and an unknown one', async (t) => {
  const { base, kobe } = await serve(t);
  const { employerLink } = await publish(kobe);
  const code = employerLink.split('/e/')[1] ?? '';

  const real = await call(base, `/api/e/${code}/login`, { body: { kind: 'access_code', secret: '000000' } });
  const unknown = await call(base, '/api/e/ZZZZZZ/login', { body: { kind: 'access_code', secret: '000000' } });

  assert.equal(real.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(real.body.error, unknown.body.error);
});

test('requesting an OTP never returns the code itself', async (t) => {
  const { base, kobe } = await serve(t);
  const { employerLink } = await publish(kobe, { contactPhone: '+255777000111' });
  const code = employerLink.split('/e/')[1] ?? '';

  const response = await call(base, `/api/e/${code}/otp`, { body: { channel: 'phone' } });
  assert.equal(response.status, 200);
  assert.equal(response.body.sent, true);
  assert.match(String(response.body.maskedDestination), /^\*+\d{3}$/);
  assert.ok(!JSON.stringify(response.body).includes('secret'));

  // It reaches the agency console instead, for staff to pass on.
  const relayed = kobe.bus.replay('agency', 'agency', 0).find((event) => event.type === 'employer_otp_requested');
  assert.ok(relayed);
});

test('an applicant token only works for that applicant', async (t) => {
  const { base, kobe } = await serve(t);
  const first = makeApplicant(kobe);
  const second = makeApplicant(kobe);

  assert.equal((await call(base, `/api/applicants/${first.applicant.id}/feed`, { token: first.token })).status, 200);
  assert.equal((await call(base, `/api/applicants/${second.applicant.id}/feed`, { token: first.token })).status, 403);
});

test('bad input is refused with a useful message', async (t) => {
  const { base, kobe } = await serve(t);
  const { applicant, token } = makeApplicant(kobe);

  const badDirection = await call(base, `/api/applicants/${applicant.id}/swipes`, {
    token, body: { jobId: 'job_missing', direction: 'sideways' },
  });
  assert.equal(badDirection.status, 400);
  assert.equal((badDirection.body.error as { code: string }).code, 'invalid_direction');

  assert.equal(
    (await call(base, `/api/applicants/${applicant.id}/swipes`, {
      token, body: { jobId: 'job_missing', direction: 'right' },
    })).status,
    404,
  );

  assert.equal(
    (await call(base, '/api/agency/applications/apl_missing/status', { key: KEY, body: { status: 'shortlisted' } })).status,
    404,
  );
});

test('unknown routes answer with JSON, not a crash', async (t) => {
  const { base } = await serve(t);
  const response = await call(base, '/api/nope');
  assert.equal(response.status, 404);
  assert.equal((response.body.error as { code: string }).code, 'not_found');
});

test('the pages and the public job view are served', async (t) => {
  const { base, kobe } = await serve(t);
  const { job, employerLink } = await publish(kobe);

  for (const path of ['/', '/jobs', '/admin', `/e/${employerLink.split('/e/')[1]}`]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, `expected ${path} to render`);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  }

  const detail = await call(base, `/api/jobs/${job.id}`);
  assert.equal(detail.status, 200);
  assert.equal((detail.body as unknown as { salaryLine: string }).salaryLine, 'USD 200 per month + tips');
  assert.equal((detail.body as unknown as { employerName: string }).employerName, 'Zanzibar Resort');
});

test('an uploaded poster is stored and served back', async (t) => {
  const { base } = await serve(t);
  // A 1x1 PNG.
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  const stored = await call(base, '/api/agency/uploads/image', {
    key: KEY, body: { filename: 'poster.png', fileBase64: png },
  });
  assert.equal(stored.status, 200);
  const path = String(stored.body.path);
  assert.match(path, /^\/uploads\/file_[a-z0-9]+\.png$/);

  const fetched = await fetch(`${base}${path}`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.headers.get('content-type'), 'image/png');

  // Path traversal is refused.
  assert.equal((await fetch(`${base}/uploads/..%2F..%2Fpackage.json`)).status, 404);
});

test('the employer stream pushes an application as it arrives', async (t) => {
  const { base, kobe } = await serve(t);
  const { job, employerId } = await publish(kobe);
  const token = kobe.access.startEmployerSession(employerId).token;

  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${base}/api/employer/stream?token=${encodeURIComponent(token)}`, {
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);

  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();

  const { applicant } = makeApplicant(kobe);
  applyTo(kobe, applicant.id, job.id);

  let buffer = '';
  const deadline = Date.now() + 5_000;
  while (!buffer.includes('application_received') && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  assert.match(buffer, /event: application_received/);
  assert.match(buffer, /"jobTitle":"Hotel Attendant"/);
});
