import test from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, reachedStatuses } from '../src/domain/applications.ts';
import type { Actor } from '../src/domain/types.ts';
import { ZANZIBAR_POSTER, makeApp, makeApplicant, publish } from './helpers.ts';

const AGENCY: Actor = { kind: 'agency', id: 'staff_amina' };

test('publishing a poster generates the swipe card and the client portal at once', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { vacancy, employerId, portalUrl, vacancyUrl, accessCode } = await publish(app);

  assert.equal(vacancy.title, 'Hotel Attendant');
  assert.equal(vacancy.positions, 8);
  assert.equal(vacancy.status, 'published');
  assert.match(vacancy.agencyRef, /^SH-JOB-\d{4}-\d{4}$/);

  // The employer never filled in a form; the portal was generated from the poster.
  assert.equal(portalUrl, 'https://sokohuru.test/client/zanzibar-resort');
  assert.equal(vacancyUrl, 'https://sokohuru.test/client/zanzibar-resort/jobs/hotel-attendant');
  assert.ok(accessCode, 'a new client gets a one-time access code');

  const employer = app.store.getEmployer(employerId);
  assert.equal(employer?.name, 'Zanzibar Resort');
  assert.equal(app.store.getPortalUrl(employerId), portalUrl);
});

test('the original poster stays attached to the vacancy as its source', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { draft } = await app.intake.uploadPost({
    channel: 'poster_image',
    text: ZANZIBAR_POSTER,
    imagePath: '/uploads/posters/ajira-exclusive.jpg',
    employerName: 'Zanzibar Resort',
    staffId: 'staff_amina',
  });
  const { vacancy } = app.intake.publishDraft(draft.id, { staffId: 'staff_amina' });

  assert.equal(vacancy.sourceImagePath, '/uploads/posters/ajira-exclusive.jpg');
  assert.equal(vacancy.intakeChannel, 'poster_image');
  assert.match(vacancy.sourceText ?? '', /AJIRA EXCLUSIVE/);
});

test('a second vacancy for the same client reuses the portal without a new code', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const first = await publish(app);
  const second = await publish(app, {
    text: 'Job title: Night Auditor\nLocation: Zanzibar\nSalary: USD 300 per month\nPositions: 2',
  });

  assert.equal(first.employerId, second.employerId);
  assert.equal(second.accessCode, null);
  assert.equal(second.vacancyUrl, 'https://sokohuru.test/client/zanzibar-resort/jobs/night-auditor');
});

test('two clients with the same name get distinct portal addresses', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  app.store.createEmployer({ name: 'Coral Hotel', slug: 'coral-hotel' });
  const published = await publish(app, { employerName: 'Coral Hotel Ltd' });
  assert.equal(published.portalUrl, 'https://sokohuru.test/client/coral-hotel-ltd');
});

test('staff corrections override what Kobe AI read', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { draft } = await app.intake.uploadPost({
    channel: 'whatsapp_text',
    text: ZANZIBAR_POSTER,
    employerName: 'Zanzibar Resort',
    staffId: 'staff_amina',
  });
  app.intake.saveCorrections(draft.id, { positions: 10, title: 'Hotel Attendant (Beach)' }, null);
  const { vacancy } = app.intake.publishDraft(draft.id, { staffId: 'staff_amina' });

  assert.equal(vacancy.positions, 10);
  assert.equal(vacancy.title, 'Hotel Attendant (Beach)');
});

test('a draft missing the essentials cannot be published', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { draft } = await app.intake.uploadPost({
    channel: 'pasted_text',
    text: 'Tunahitaji wafanyakazi wa aina mbalimbali.',
    employerName: 'Some Client',
    staffId: 'staff_amina',
  });

  assert.throws(
    () => app.intake.publishDraft(draft.id, { staffId: 'staff_amina' }),
    (error: Error & { code?: string }) => error.code === 'incomplete_vacancy' && /salary/.test(error.message),
  );
});

test('an upload with no readable text is refused', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  await assert.rejects(
    () => app.intake.uploadPost({ channel: 'poster_image', text: '   ', staffId: 'staff_amina' }),
    (error: Error & { code?: string }) => error.code === 'empty_post',
  );
});

test('a right swipe files the application and confirms it to the applicant', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { vacancy } = await publish(app);
  const { applicant } = makeApplicant(app);

  const cards = app.swipe.feed(applicant.id);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.title, 'Hotel Attendant');
  assert.equal(cards[0]?.salaryLine, 'USD 200 per month + tips');
  assert.equal(cards[0]?.positionsLine, '8 positions available');
  assert.ok(cards[0]?.highlights.includes('Accommodation provided'));
  assert.equal(cards[0]?.postedThrough, 'Posted through Soko Huru');

  const outcome = app.swipe.swipe(applicant.id, vacancy.id, 'right');
  assert.equal(outcome.result, 'applied');
  if (outcome.result !== 'applied') return;

  assert.equal(outcome.confirmation.message, 'Application submitted successfully');
  assert.equal(outcome.confirmation.position, 'Hotel Attendant');
  assert.equal(outcome.confirmation.company, 'Zanzibar Resort');
  assert.equal(outcome.confirmation.submittedThrough, 'Soko Huru');
  assert.equal(outcome.confirmation.cvUsed, 'Hospitality CV');
  assert.equal(outcome.confirmation.status, 'Received');
  assert.match(outcome.confirmation.applicationNumber, /^SH-\d{4}-\d{6}$/);

  // The applicant never filled in a form: the CV came from their profile.
  assert.equal(outcome.application.cvId, app.store.listCvs(applicant.id)[0]?.id);
});

test('application numbers run in sequence within the year', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { vacancy } = await publish(app);
  const first = makeApplicant(app, { phone: '+255711000101' });
  const second = makeApplicant(app, { phone: '+255711000102' });

  const one = app.swipe.swipe(first.applicant.id, vacancy.id, 'right');
  const two = app.swipe.swipe(second.applicant.id, vacancy.id, 'right');
  assert.ok(one.result === 'applied' && two.result === 'applied');
  if (one.result !== 'applied' || two.result !== 'applied') return;

  const year = new Date().getUTCFullYear();
  assert.equal(one.confirmation.applicationNumber, `SH-${year}-000001`);
  assert.equal(two.confirmation.applicationNumber, `SH-${year}-000002`);
});

test('left and up swipes do not create applications', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { vacancy } = await publish(app);
  const { applicant } = makeApplicant(app);

  assert.equal(app.swipe.swipe(applicant.id, vacancy.id, 'up').result, 'saved');
  assert.equal(app.swipe.savedJobs(applicant.id).length, 1);
  assert.equal(app.store.listApplicationsForApplicant(applicant.id).length, 0);

  assert.equal(app.swipe.swipe(applicant.id, vacancy.id, 'left').result, 'skipped');
  // A skipped card never comes back in the deck.
  assert.equal(app.swipe.feed(applicant.id).length, 0);
});

test('applying without a membership is blocked and names the package to buy', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { vacancy } = await publish(app);
  const { applicant } = makeApplicant(app, { packageCode: null });

  const outcome = app.swipe.swipe(applicant.id, vacancy.id, 'right');
  assert.equal(outcome.result, 'blocked');
  if (outcome.result !== 'blocked') return;
  assert.equal(outcome.code, 'no_membership');
  assert.equal(outcome.upgradeTo?.code, 'non_certificate');
  assert.equal(app.store.listApplicationsForApplicant(applicant.id).length, 0);
});

test('the wrong package is blocked even though the card matched', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { vacancy } = await publish(app, {
    employerName: 'Mwanga Private School',
    text: [
      'Job title: Secondary School Teacher',
      'Location: Arusha',
      'Positions: 4',
      'Salary: TSh 700,000 per month',
      'Education: Degree in education',
      'Certificate required',
    ].join('\n'),
  });
  assert.equal(vacancy.certificateRequired, true);

  const { applicant } = makeApplicant(app, {
    location: 'Arusha',
    categories: ['teaching'],
    educationLevel: 'degree',
    packageCode: 'non_certificate',
  });

  const outcome = app.swipe.swipe(applicant.id, vacancy.id, 'right');
  assert.equal(outcome.result, 'blocked');
  if (outcome.result !== 'blocked') return;
  assert.equal(outcome.code, 'package_excludes_certificate_jobs');
  assert.equal(outcome.upgradeTo?.code, 'certificate');
});

test('an applicant cannot apply twice to the same vacancy', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { vacancy } = await publish(app);
  const { applicant } = makeApplicant(app);

  const first = app.swipe.swipe(applicant.id, vacancy.id, 'right');
  const second = app.swipe.swipe(applicant.id, vacancy.id, 'right');
  assert.equal(first.result, 'applied');
  assert.equal(second.result, 'blocked');
  if (second.result !== 'blocked') return;
  assert.equal(second.code, 'already_applied');
  assert.equal(app.store.listApplicationsForApplicant(applicant.id).length, 1);
});

test('each accepted application spends one of the package allowance', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { vacancy } = await publish(app);
  const { applicant } = makeApplicant(app);

  assert.equal(app.memberships.view(applicant.id).applicationsRemaining, 30);
  app.swipe.swipe(applicant.id, vacancy.id, 'right');
  assert.equal(app.memberships.view(applicant.id).applicationsRemaining, 29);
});

test('the feed hides vacancies the applicant is not eligible for', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  await publish(app); // female-only hotel attendants
  const { applicant } = makeApplicant(app, { gender: 'male', phone: '+255711000201' });

  assert.equal(app.swipe.feed(applicant.id).length, 0);
});

test("the employer's page fills up the moment someone swipes right", async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { vacancy, employerId } = await publish(app);
  const { applicant } = makeApplicant(app);

  const seen: string[] = [];
  app.bus.subscribe('employer', employerId, (event) => seen.push(event.type));

  app.swipe.swipe(applicant.id, vacancy.id, 'right');

  assert.deepEqual(seen, ['application_received']);
  const dashboard = app.employer.dashboard(employerId);
  assert.equal(dashboard.totals.applications, 1);
  assert.equal(dashboard.totals.newApplications, 1);
  assert.equal(dashboard.vacancies[0]?.remainingPositions, 8);
});

test('the employer counters follow the status flow', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { vacancy, employerId } = await publish(app);
  const { applicant } = makeApplicant(app);
  const employerActor: Actor = { kind: 'employer', id: employerId };

  const outcome = app.swipe.swipe(applicant.id, vacancy.id, 'right');
  assert.equal(outcome.result, 'applied');
  if (outcome.result !== 'applied') return;
  const applicationId = outcome.application.id;

  app.employer.openApplication(employerId, applicationId, employerActor);
  let stats = app.store.vacancyStats(vacancy.id);
  assert.equal(stats?.viewed, 1);
  assert.equal(stats?.newApplications, 0);

  app.employer.shortlist(employerId, applicationId, employerActor, 'Strong experience');
  app.employer.inviteToInterview(employerId, applicationId, '2026-08-20T07:00:00.000Z', employerActor, null);

  stats = app.store.vacancyStats(vacancy.id);
  // Reaching a later stage does not empty the earlier tiles.
  assert.equal(stats?.viewed, 1);
  assert.equal(stats?.shortlisted, 1);
  assert.equal(stats?.interviewInvited, 1);

  const dossier = app.employer.openApplication(employerId, applicationId, employerActor);
  assert.equal(dossier.application.interviewAt, '2026-08-20T07:00:00.000Z');
  assert.deepEqual(
    [...reachedStatuses(dossier.history)].sort(),
    ['applied', 'interview_invited', 'shortlisted', 'viewed'],
  );
});

test('hiring the last position closes the vacancy for everyone', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { vacancy, employerId } = await publish(app, {
    text: 'Job title: Head Chef\nLocation: Zanzibar\nSalary: USD 500 per month\nPositions: 1',
  });
  const { applicant } = makeApplicant(app, { categories: ['hospitality'] });
  const employerActor: Actor = { kind: 'employer', id: employerId };

  const outcome = app.swipe.swipe(applicant.id, vacancy.id, 'right');
  assert.equal(outcome.result, 'applied');
  if (outcome.result !== 'applied') return;

  const id = outcome.application.id;
  app.employer.transition(employerId, id, 'shortlisted', employerActor, null);
  app.employer.transition(employerId, id, 'interview_invited', employerActor, null);
  app.employer.transition(employerId, id, 'interview_completed', employerActor, null);
  app.employer.markHired(employerId, id, employerActor, 'Starts Monday');

  assert.equal(app.store.getVacancy(vacancy.id)?.status, 'filled');
  assert.equal(app.store.vacancyStats(vacancy.id)?.remainingPositions, 0);

  const other = makeApplicant(app, { phone: '+255711000301' });
  assert.equal(app.swipe.feed(other.applicant.id).length, 0);
});

test('the status flow refuses shortcuts and wrong actors', () => {
  assert.equal(canTransition('applied', 'viewed', 'employer').ok, true);
  assert.equal(canTransition('applied', 'hired', 'employer').ok, false);
  assert.equal(canTransition('shortlisted', 'viewed', 'employer').ok, false);
  assert.equal(canTransition('hired', 'rejected', 'employer').ok, false);
  // Applicants may only withdraw; they cannot hire themselves.
  assert.equal(canTransition('applied', 'shortlisted', 'applicant').ok, false);
  assert.equal(canTransition('applied', 'withdrawn', 'applicant').ok, true);
  assert.equal(canTransition('interview_completed', 'hired', 'agency').ok, true);
});

test('an invalid transition is rejected by the service too', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { vacancy, employerId } = await publish(app);
  const { applicant } = makeApplicant(app);
  const outcome = app.swipe.swipe(applicant.id, vacancy.id, 'right');
  assert.equal(outcome.result, 'applied');
  if (outcome.result !== 'applied') return;

  assert.throws(
    () => app.employer.transition(employerId, outcome.application.id, 'hired', { kind: 'employer', id: employerId }, null),
    /Cannot move an application from Applied to Hired/,
  );
});

test('one client can never reach another client’s applicants', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const zanzibar = await publish(app);
  const school = await publish(app, {
    employerName: 'Mwanga Private School',
    text: 'Job title: Teacher\nLocation: Arusha\nSalary: TSh 700,000 per month\nPositions: 2',
  });

  const { applicant } = makeApplicant(app);
  const outcome = app.swipe.swipe(applicant.id, zanzibar.vacancy.id, 'right');
  assert.equal(outcome.result, 'applied');
  if (outcome.result !== 'applied') return;

  assert.equal(app.employer.applications(school.employerId).length, 0);
  assert.throws(
    () => app.employer.openApplication(school.employerId, outcome.application.id, { kind: 'employer', id: school.employerId }),
    /Application not found/,
  );
  assert.throws(() => app.employer.vacancy(school.employerId, zanzibar.vacancy.id), /Vacancy not found/);
});

test('employers can filter their applicant list', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { vacancy, employerId } = await publish(app);
  const neema = makeApplicant(app, { fullName: 'Neema Joseph', phone: '+255711000401', location: 'Dar es Salaam', experienceYears: 2 });
  const asha = makeApplicant(app, { fullName: 'Asha Mwinyi', phone: '+255711000402', location: 'Zanzibar', experienceYears: 5 });

  app.swipe.swipe(neema.applicant.id, vacancy.id, 'right');
  app.swipe.swipe(asha.applicant.id, vacancy.id, 'right');

  assert.equal(app.employer.applications(employerId).length, 2);
  assert.equal(app.employer.applications(employerId, { location: 'Zanzibar' }).length, 1);
  assert.equal(app.employer.applications(employerId, { minExperienceYears: 4 })[0]?.applicant.fullName, 'Asha Mwinyi');
  assert.equal(app.employer.applications(employerId, { search: 'neema' })[0]?.applicant.fullName, 'Neema Joseph');
  assert.equal(app.employer.applications(employerId, { language: 'English' }).length, 2);
  assert.equal(app.employer.applications(employerId, { status: 'applied' }).length, 2);
});

test('Soko Huru sees every client and can act for them', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { vacancy, employerId } = await publish(app);
  const { applicant } = makeApplicant(app);
  const outcome = app.swipe.swipe(applicant.id, vacancy.id, 'right');
  assert.equal(outcome.result, 'applied');
  if (outcome.result !== 'applied') return;

  const overview = app.agency.overview();
  assert.equal(overview.length, 1);
  assert.equal(overview[0]?.employerName, 'Zanzibar Resort');
  assert.equal(overview[0]?.jobTitle, 'Hotel Attendant');
  assert.equal(overview[0]?.applications, 1);
  assert.equal(overview[0]?.unreviewedApplications, 1);

  // Shortlisting on the client's behalf.
  app.employer.shortlist(employerId, outcome.application.id, AGENCY, 'Called the candidate');
  assert.equal(app.store.getApplication(outcome.application.id)?.status, 'shortlisted');

  const report = app.agency.report();
  assert.equal(report.totals.clients, 1);
  assert.equal(report.totals.applications, 1);
  assert.equal(report.totals.shortlisted, 1);
  assert.equal(report.totals.positions, 8);
});

test('clients who never open their page are flagged for chasing', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { vacancy, employerId } = await publish(app);
  const { applicant } = makeApplicant(app);
  app.swipe.swipe(applicant.id, vacancy.id, 'right');

  assert.equal(app.agency.clientsNotReviewing().length, 1);

  app.store.markEmployerSeen(employerId);
  assert.equal(app.agency.clientsNotReviewing().length, 0);
});

test('a request for more candidates reaches the Soko Huru dashboard', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { vacancy, employerId } = await publish(app);
  app.employer.requestMoreCandidates(employerId, vacancy.id, 'We need eight more by Friday');

  const events = app.bus.replay('agency', 'soko-huru', 0);
  const request = events.find((event) => event.type === 'more_candidates_requested');
  assert.ok(request);
  assert.deepEqual((request.payload as { message: string }).message, 'We need eight more by Friday');
});

test('applicants can follow their own applications', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { vacancy, employerId } = await publish(app);
  const { applicant } = makeApplicant(app);
  const outcome = app.swipe.swipe(applicant.id, vacancy.id, 'right');
  assert.equal(outcome.result, 'applied');
  if (outcome.result !== 'applied') return;

  let tracker = app.swipe.tracker(applicant.id);
  assert.equal(tracker[0]?.statusLabel, 'Applied');
  assert.equal(tracker[0]?.employerName, 'Zanzibar Resort');

  app.employer.shortlist(employerId, outcome.application.id, { kind: 'employer', id: employerId }, null);
  tracker = app.swipe.tracker(applicant.id);
  assert.equal(tracker[0]?.statusLabel, 'Shortlisted');
  assert.equal(tracker[0]?.step, 2);

  const events = app.bus.replay('applicant', applicant.id, 0);
  assert.ok(events.some((event) => event.type === 'application_status_changed'));
});

test('missed dashboard events can be replayed after a reconnect', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const { vacancy, employerId } = await publish(app);
  const { applicant } = makeApplicant(app);
  app.swipe.swipe(applicant.id, vacancy.id, 'right');

  const all = app.bus.replay('employer', employerId, 0);
  assert.ok(all.length >= 2);
  const afterFirst = app.bus.replay('employer', employerId, all[0]?.id ?? 0);
  assert.equal(afterFirst.length, all.length - 1);
});
