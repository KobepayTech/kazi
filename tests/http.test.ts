import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Kobeos } from '../src/app.ts';
import { createServer } from '../src/http/server.ts';
import { makeApp, makeApplicant, publish } from './helpers.ts';

async function listen(app: Kobeos): Promise<{ base: string; server: Server }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, server };
}

type ApiResponse = { status: number; body: Record<string, never> & Record<string, unknown> };

async function call(
  base: string,
  path: string,
  options: { method?: string; token?: string; key?: string; body?: unknown } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.key) headers['x-agency-key'] = options.key;
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? (options.body ? 'POST' : 'GET'),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = (await response.json().catch(() => ({}))) as ApiResponse['body'];
  return { status: response.status, body };
}

test('the whole workflow runs over HTTP', async (t) => {
  const app = makeApp();
  const { base, server } = await listen(app);
  t.after(() => {
    server.close();
    app.close();
  });
  const key = app.config.agencyApiKey;

  // 1. Soko Huru uploads the poster it already sent out.
  const upload = await call(base, '/api/agency/uploads', {
    key,
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
  const extraction = upload.body.extraction as { vacancy: { title: string; positions: number } };
  assert.equal(extraction.vacancy.title, 'Hotel Attendant');
  assert.equal(extraction.vacancy.positions, 8);

  // 2. Staff correct a field and publish.
  const corrected = await call(base, `/api/agency/drafts/${draft.id}`, {
    method: 'PATCH',
    key,
    body: { corrections: { positions: 8, experienceNote: 'Hospitality experience preferred' } },
  });
  assert.equal(corrected.status, 200);

  const publishResponse = await call(base, `/api/agency/drafts/${draft.id}/publish`, { key, body: {} });
  assert.equal(publishResponse.status, 200);
  const published = publishResponse.body as unknown as {
    vacancy: { id: string };
    portalUrl: string;
    employerAccessCode: { secret: string };
  };
  assert.equal(published.portalUrl, 'https://sokohuru.test/client/zanzibar-resort');

  // 3. An applicant with a paid membership swipes right.
  const { applicant } = makeApplicant(app);
  const sessionResponse = await call(base, `/api/applicants/${applicant.id}/session`, { key, body: {} });
  assert.equal(sessionResponse.status, 200);
  const applicantToken = (sessionResponse.body as unknown as { token: string }).token;

  const feed = await call(base, `/api/applicants/${applicant.id}/feed`, { token: applicantToken });
  assert.equal(feed.status, 200);
  const cards = (feed.body as unknown as { cards: { vacancyId: string; title: string }[] }).cards;
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.title, 'Hotel Attendant');

  const swipe = await call(base, `/api/applicants/${applicant.id}/swipes`, {
    token: applicantToken,
    body: { vacancyId: published.vacancy.id, direction: 'right' },
  });
  assert.equal(swipe.status, 200);
  const outcome = swipe.body as unknown as {
    result: string;
    confirmation: { applicationNumber: string; company: string };
    application: { id: string };
  };
  assert.equal(outcome.result, 'applied');
  assert.equal(outcome.confirmation.company, 'Zanzibar Resort');

  // 4. The employer signs in with the code Soko Huru gave them.
  const login = await call(base, '/api/employer/login', {
    body: { slug: 'zanzibar-resort', kind: 'one_time_code', secret: published.employerAccessCode.secret },
  });
  assert.equal(login.status, 200);
  const employerToken = (login.body as unknown as { token: string }).token;

  const dashboard = await call(base, '/api/employer/dashboard', { token: employerToken });
  assert.equal(dashboard.status, 200);
  const totals = (dashboard.body as unknown as { totals: { applications: number; newApplications: number } }).totals;
  assert.equal(totals.applications, 1);
  assert.equal(totals.newApplications, 1);

  // 5. The employer opens the candidate and shortlists them.
  const opened = await call(base, `/api/employer/applications/${outcome.application.id}`, { token: employerToken });
  assert.equal(opened.status, 200);
  assert.equal((opened.body as unknown as { statusLabel: string }).statusLabel, 'Viewed');

  const shortlisted = await call(base, `/api/employer/applications/${outcome.application.id}/status`, {
    token: employerToken,
    body: { status: 'shortlisted', note: 'Good fit' },
  });
  assert.equal(shortlisted.status, 200);

  // 6. The applicant sees the new status on their own tracker.
  const tracker = await call(base, `/api/applicants/${applicant.id}/applications`, { token: applicantToken });
  const tracked = (tracker.body as unknown as { applications: { statusLabel: string }[] }).applications;
  assert.equal(tracked[0]?.statusLabel, 'Shortlisted');
});

test('the agency API refuses a missing or wrong staff key', async (t) => {
  const app = makeApp();
  const { base, server } = await listen(app);
  t.after(() => {
    server.close();
    app.close();
  });

  assert.equal((await call(base, '/api/agency/overview')).status, 401);
  assert.equal((await call(base, '/api/agency/overview', { key: 'wrong' })).status, 401);
  assert.equal((await call(base, '/api/agency/overview', { key: app.config.agencyApiKey })).status, 200);
});

test('employer endpoints need a session, and never leak another client', async (t) => {
  const app = makeApp();
  const { base, server } = await listen(app);
  t.after(() => {
    server.close();
    app.close();
  });

  const zanzibar = await publish(app);
  const school = await publish(app, {
    employerName: 'Mwanga Private School',
    text: 'Job title: Teacher\nLocation: Arusha\nSalary: TSh 700,000 per month\nPositions: 2',
  });
  const { applicant } = makeApplicant(app);
  const outcome = app.swipe.swipe(applicant.id, zanzibar.vacancy.id, 'right');
  assert.equal(outcome.result, 'applied');
  if (outcome.result !== 'applied') return;

  assert.equal((await call(base, '/api/employer/dashboard')).status, 401);
  assert.equal((await call(base, '/api/employer/dashboard', { token: 'made-up' })).status, 401);

  const schoolToken = app.access.startSession(school.employerId).token;
  const leak = await call(base, `/api/employer/applications/${outcome.application.id}`, { token: schoolToken });
  assert.equal(leak.status, 404);
});

test('signing in with a bad code says the same thing for real and unknown clients', async (t) => {
  const app = makeApp();
  const { base, server } = await listen(app);
  t.after(() => {
    server.close();
    app.close();
  });
  await publish(app);

  const realClient = await call(base, '/api/employer/login', {
    body: { slug: 'zanzibar-resort', kind: 'one_time_code', secret: '00000000' },
  });
  const unknownClient = await call(base, '/api/employer/login', {
    body: { slug: 'no-such-client', kind: 'one_time_code', secret: '00000000' },
  });

  assert.equal(realClient.status, 401);
  assert.equal(unknownClient.status, 401);
  assert.deepEqual(realClient.body.error, unknownClient.body.error);
});

test('an applicant token only works for that applicant', async (t) => {
  const app = makeApp();
  const { base, server } = await listen(app);
  t.after(() => {
    server.close();
    app.close();
  });

  const first = makeApplicant(app, { phone: '+255711000501' });
  const second = makeApplicant(app, { phone: '+255711000502' });
  const token = app.access.startApplicantSession(first.applicant.id).token;

  assert.equal((await call(base, `/api/applicants/${first.applicant.id}/feed`, { token })).status, 200);
  assert.equal((await call(base, `/api/applicants/${second.applicant.id}/feed`, { token })).status, 403);
});

test('bad input is rejected with a useful message', async (t) => {
  const app = makeApp();
  const { base, server } = await listen(app);
  t.after(() => {
    server.close();
    app.close();
  });

  const { applicant } = makeApplicant(app);
  const token = app.access.startApplicantSession(applicant.id).token;

  const badDirection = await call(base, `/api/applicants/${applicant.id}/swipes`, {
    token,
    body: { vacancyId: 'vac_missing', direction: 'sideways' },
  });
  assert.equal(badDirection.status, 400);
  assert.equal((badDirection.body.error as { code: string }).code, 'invalid_direction');

  const missingVacancy = await call(base, `/api/applicants/${applicant.id}/swipes`, {
    token,
    body: { vacancyId: 'vac_missing', direction: 'right' },
  });
  assert.equal(missingVacancy.status, 404);

  const badStatus = await call(base, '/api/agency/applications/apl_missing/status', {
    key: app.config.agencyApiKey,
    body: { status: 'promoted' },
  });
  assert.equal(badStatus.status, 404);
});

test('unknown routes answer with JSON, not a crash', async (t) => {
  const app = makeApp();
  const { base, server } = await listen(app);
  t.after(() => {
    server.close();
    app.close();
  });

  const response = await call(base, '/api/nope');
  assert.equal(response.status, 404);
  assert.equal((response.body.error as { code: string }).code, 'not_found');
});

test('the pages and the public vacancy view are served', async (t) => {
  const app = makeApp();
  const { base, server } = await listen(app);
  t.after(() => {
    server.close();
    app.close();
  });

  const { vacancy } = await publish(app);

  for (const path of ['/', '/swipe', '/agency', '/client/zanzibar-resort']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, `expected ${path} to render`);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  }

  const detail = await call(base, `/api/vacancies/${vacancy.id}`);
  assert.equal(detail.status, 200);
  assert.equal((detail.body as unknown as { salaryLine: string }).salaryLine, 'USD 200 per month + tips');
  assert.equal((detail.body as unknown as { employerName: string }).employerName, 'Zanzibar Resort');
});

test('the employer dashboard stream pushes an application as it arrives', async (t) => {
  const app = makeApp();
  const { base, server } = await listen(app);
  t.after(() => {
    server.close();
    app.close();
  });

  const { vacancy, employerId } = await publish(app);
  const token = app.access.startSession(employerId).token;

  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${base}/api/employer/stream?token=${encodeURIComponent(token)}`, {
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);

  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();

  const { applicant } = makeApplicant(app);
  app.swipe.swipe(applicant.id, vacancy.id, 'right');

  let buffer = '';
  const deadline = Date.now() + 5_000;
  while (!buffer.includes('application_received') && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  assert.match(buffer, /event: application_received/);
  assert.match(buffer, /"vacancyTitle":"Hotel Attendant"/);
});
