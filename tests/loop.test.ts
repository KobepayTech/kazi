import test from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, reachedStatuses } from '../src/domain/applications.ts';
import type { Actor } from '../src/domain/types.ts';
import { ZANZIBAR_POSTER, applyTo, makeApplicant, makeHarness, publish } from './helpers.ts';

test('publishing a poster creates the card and the employer link together', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { job, employerId, employerLink, accessCode } = await publish(kobe);

  assert.equal(job.title, 'Hotel Attendant');
  assert.equal(job.positions, 8);
  assert.equal(job.status, 'published');
  assert.match(job.reference, /^SH-JOB-\d{4}-\d{4}$/);

  // The employer filled in nothing: the record and the link came from the poster.
  assert.match(employerLink, /^https:\/\/jobs\.kobeos\.test\/e\/[0-9A-Z]{6}$/);
  assert.ok(accessCode, 'a new client gets an access code');
  assert.equal(kobe.store.getEmployer(employerId)?.name, 'Zanzibar Resort');
});

test('the original poster stays attached to the job', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { job } = await publish(kobe, { imagePath: '/uploads/ajira-exclusive.jpg' });
  assert.equal(job.sourceImagePath, '/uploads/ajira-exclusive.jpg');
  assert.match(job.sourceText ?? '', /AJIRA EXCLUSIVE/);

  const detail = kobe.swipe.jobDetail(job.id);
  assert.equal(detail.job.sourceImagePath, '/uploads/ajira-exclusive.jpg');
});

test('a second job for the same client reuses the client and its link', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const first = await publish(kobe);
  const second = await publish(kobe, {
    text: 'Job title: Night Auditor\nLocation: Zanzibar\nSalary: USD 300 per month\nPositions: 2',
  });

  assert.equal(first.employerId, second.employerId);
  assert.equal(first.employerLink, second.employerLink);
  assert.equal(second.accessCode, null, 'an existing client keeps the code they have');
});

test('staff corrections override what Kobe AI read', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { draft } = await kobe.intake.uploadPost({
    channel: 'whatsapp_text',
    text: ZANZIBAR_POSTER,
    employerName: 'Zanzibar Resort',
    staffId: 'staff_amina',
  });
  kobe.intake.saveCorrections(draft.id, { positions: 10, title: 'Hotel Attendant (Beach)' }, null);
  const { job } = kobe.intake.publishDraft(draft.id, { staffId: 'staff_amina' });

  assert.equal(job.positions, 10);
  assert.equal(job.title, 'Hotel Attendant (Beach)');
});

test('a draft missing the essentials cannot be published', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { draft } = await kobe.intake.uploadPost({
    channel: 'pasted_text',
    text: 'Tunahitaji wafanyakazi wa aina mbalimbali.',
    employerName: 'Some Client',
    staffId: 'staff_amina',
  });

  assert.throws(
    () => kobe.intake.publishDraft(draft.id, { staffId: 'staff_amina' }),
    (error: Error & { code?: string }) => error.code === 'incomplete_job' && /salary/.test(error.message),
  );
});

test('an upload with no readable text is refused', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  await assert.rejects(
    () => kobe.intake.uploadPost({ channel: 'poster_image', text: '   ', staffId: 'staff_amina' }),
    (error: Error & { code?: string }) => error.code === 'empty_post',
  );
});

test('registration writes the CV; the applicant never uploads one', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { applicant } = makeApplicant(kobe, {
    fullName: 'Neema Joseph',
    categories: ['hospitality'],
    experienceYears: 2,
  });
  const cv = kobe.applicants.cv(applicant.id);

  assert.equal(cv.fullName, 'Neema Joseph');
  assert.match(cv.headline, /hospitality/i);
  assert.match(cv.summary, /2 year/);
  assert.equal(cv.applicantId, applicant.id);

  const text = kobe.applicants.cvText(applicant.id);
  assert.match(text, /NEEMA JOSEPH/);
  assert.match(text, /SKILLS/);
});

test('the CV is rewritten when the profile changes', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { applicant } = makeApplicant(kobe, { experienceYears: 1 });
  const before = kobe.applicants.cv(applicant.id);
  kobe.applicants.updateProfile(applicant.id, { experienceYears: 5, skills: ['Front desk'] });
  const after = kobe.applicants.cv(applicant.id);

  assert.equal(before.id, after.id, 'one CV per applicant');
  assert.equal(after.experienceYears, 5);
  assert.deepEqual(after.skills, ['Front desk']);
});

test('a right swipe asks before it sends anything', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { job } = await publish(kobe);
  const { applicant } = makeApplicant(kobe);

  const prompt = kobe.swipe.swipe(applicant.id, job.id, 'right');
  assert.equal(prompt.result, 'confirm_required');
  if (prompt.result !== 'confirm_required') return;
  assert.equal(prompt.prompt.title, 'Hotel Attendant');
  assert.equal(prompt.prompt.employerName, 'Zanzibar Resort');
  assert.match(prompt.prompt.message, /CV will be shared/);

  // An accidental swipe must not create an application.
  assert.equal(kobe.store.listApplicationsForApplicant(applicant.id).length, 0);
});

test('confirming the swipe files the application and attaches the CV', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { job } = await publish(kobe);
  const { applicant } = makeApplicant(kobe);

  const cards = kobe.swipe.feed(applicant.id);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.salaryLine, 'USD 200 per month + tips');
  assert.equal(cards[0]?.positionsLine, '8 positions');
  assert.ok(cards[0]?.highlights.includes('Accommodation provided'));
  assert.equal(cards[0]?.postedThrough, 'Posted through Soko Huru');

  const outcome = applyTo(kobe, applicant.id, job.id);
  assert.equal(outcome.result, 'applied');
  if (outcome.result !== 'applied') return;

  assert.equal(outcome.confirmation.message, 'Application submitted successfully');
  assert.equal(outcome.confirmation.company, 'Zanzibar Resort');
  assert.equal(outcome.confirmation.submittedThrough, 'Soko Huru');
  assert.match(outcome.confirmation.applicationNumber, /^SH-\d{4}-\d{6}$/);
  assert.equal(outcome.application.cvId, kobe.applicants.cv(applicant.id).id);
});

test('application numbers run in sequence within the year', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { job } = await publish(kobe);
  const first = makeApplicant(kobe);
  const second = makeApplicant(kobe);

  const one = applyTo(kobe, first.applicant.id, job.id);
  const two = applyTo(kobe, second.applicant.id, job.id);
  assert.ok(one.result === 'applied' && two.result === 'applied');
  if (one.result !== 'applied' || two.result !== 'applied') return;

  const year = new Date().getUTCFullYear();
  assert.equal(one.confirmation.applicationNumber, `SH-${year}-000001`);
  assert.equal(two.confirmation.applicationNumber, `SH-${year}-000002`);
});

test('left skips and star saves, without applying', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { job } = await publish(kobe);
  const { applicant } = makeApplicant(kobe);

  assert.equal(kobe.swipe.swipe(applicant.id, job.id, 'up').result, 'saved');
  assert.equal(kobe.swipe.savedJobs(applicant.id).length, 1);
  assert.equal(kobe.store.listApplicationsForApplicant(applicant.id).length, 0);

  assert.equal(kobe.swipe.swipe(applicant.id, job.id, 'left').result, 'skipped');
  assert.equal(kobe.swipe.feed(applicant.id).length, 0, 'a skipped job does not come back');
});

test('applying without a membership is blocked and names the package to buy', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { job } = await publish(kobe);
  const { applicant } = makeApplicant(kobe, { planCode: null });

  const outcome = applyTo(kobe, applicant.id, job.id);
  assert.equal(outcome.result, 'blocked');
  if (outcome.result !== 'blocked') return;
  assert.equal(outcome.code, 'no_membership');
  assert.equal(outcome.upgradeTo?.code, 'non_certificate');
  assert.equal(kobe.store.listApplicationsForApplicant(applicant.id).length, 0);
});

test('an unconfirmed payment does not let anyone apply yet', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { job } = await publish(kobe);
  const { applicant } = makeApplicant(kobe, { confirmPayment: false });

  const outcome = applyTo(kobe, applicant.id, job.id);
  assert.equal(outcome.result, 'blocked');
  if (outcome.result !== 'blocked') return;
  assert.equal(outcome.code, 'membership_pending_payment');
});

test('the wrong package is blocked even though the card matched', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { job } = await publish(kobe, {
    employerName: 'Mwanga Private School',
    text: [
      'Job title: Secondary School Teacher',
      'Location: Arusha',
      'Positions: 4',
      'Salary: TSh 700,000 per month',
      'Certificate required',
    ].join('\n'),
  });
  assert.equal(job.certificateRequired, true);

  const { applicant } = makeApplicant(kobe, {
    location: 'Arusha',
    categories: ['teaching'],
    planCode: 'non_certificate',
  });

  const outcome = applyTo(kobe, applicant.id, job.id);
  assert.equal(outcome.result, 'blocked');
  if (outcome.result !== 'blocked') return;
  assert.equal(outcome.code, 'plan_excludes_certificate_jobs');
  assert.equal(outcome.upgradeTo?.code, 'certificate');
});

test('nobody applies to the same job twice', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { job } = await publish(kobe);
  const { applicant } = makeApplicant(kobe);

  assert.equal(applyTo(kobe, applicant.id, job.id).result, 'applied');
  const second = applyTo(kobe, applicant.id, job.id);
  assert.equal(second.result, 'blocked');
  if (second.result !== 'blocked') return;
  assert.equal(second.code, 'already_applied');
  assert.equal(kobe.store.listApplicationsForApplicant(applicant.id).length, 1);
});

test('the four filters decide what reaches the deck', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  await publish(kobe); // hospitality, Zanzibar, USD 200 -> TSh 520,000
  await publish(kobe, {
    employerName: 'City Logistics',
    text: 'Job title: Driver\nLocation: Mwanza\nSalary: TSh 900,000 per month\nPositions: 3\nLeseni daraja C inahitajika',
  });

  const hospitality = makeApplicant(kobe, { categories: ['hospitality'] });
  assert.deepEqual(kobe.swipe.feed(hospitality.applicant.id).map((card) => card.title), ['Hotel Attendant']);

  const wealthy = makeApplicant(kobe, { categories: [], minSalaryTzs: 800_000 });
  assert.deepEqual(kobe.swipe.feed(wealthy.applicant.id).map((card) => card.title), ['Driver']);

  const noCertificate = makeApplicant(kobe, { categories: [] });
  kobe.applicants.savePreferences(noCertificate.applicant.id, {
    categories: [], locations: [], minSalaryTzs: null, certificateRequired: false,
  });
  assert.deepEqual(kobe.swipe.feed(noCertificate.applicant.id).map((card) => card.title), ['Hotel Attendant']);

  const zanzibarOnly = makeApplicant(kobe, { categories: [] });
  kobe.applicants.savePreferences(zanzibarOnly.applicant.id, {
    categories: [], locations: ['Zanzibar'], minSalaryTzs: null, certificateRequired: null,
  });
  assert.deepEqual(kobe.swipe.feed(zanzibarOnly.applicant.id).map((card) => card.title), ['Hotel Attendant']);
});

test("the employer's page fills up the moment someone applies", async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { job, employerId } = await publish(kobe);
  const { applicant } = makeApplicant(kobe);

  const seen: string[] = [];
  kobe.bus.subscribe('employer', employerId, (event) => seen.push(event.type));

  applyTo(kobe, applicant.id, job.id);

  assert.deepEqual(seen, ['application_received']);
  const dashboard = kobe.employer.dashboard(employerId);
  assert.equal(dashboard.totals.applications, 1);
  assert.equal(dashboard.totals.newApplications, 1);
  assert.equal(dashboard.jobs[0]?.remainingPositions, 8);
});

test('the employer counters follow the status flow', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { job, employerId } = await publish(kobe);
  const { applicant } = makeApplicant(kobe);
  const actor: Actor = { kind: 'employer', id: employerId };

  const outcome = applyTo(kobe, applicant.id, job.id);
  assert.equal(outcome.result, 'applied');
  if (outcome.result !== 'applied') return;
  const applicationId = outcome.application.id;

  // Opening the CV is what marks the candidate viewed.
  const dossier = kobe.employer.openCandidate(employerId, applicationId, actor);
  assert.match(dossier.cvText, /NEEMA JOSEPH/);
  assert.equal(kobe.store.jobStats(job.id)?.viewed, 1);
  assert.equal(kobe.store.jobStats(job.id)?.newApplications, 0);

  kobe.employer.shortlist(employerId, applicationId, actor, 'Strong experience');
  kobe.employer.inviteToInterview(employerId, applicationId, actor, null);

  const stats = kobe.store.jobStats(job.id);
  assert.equal(stats?.viewed, 1, 'earlier tiles keep their count');
  assert.equal(stats?.shortlisted, 1);
  assert.equal(stats?.interview, 1);

  assert.deepEqual(
    [...reachedStatuses(kobe.store.listStatusHistory(applicationId))].sort(),
    ['applied', 'interview', 'shortlisted', 'viewed'],
  );
});

test('shortlisting tells the applicant immediately', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { job, employerId } = await publish(kobe);
  const { applicant } = makeApplicant(kobe);
  const outcome = applyTo(kobe, applicant.id, job.id);
  assert.equal(outcome.result, 'applied');
  if (outcome.result !== 'applied') return;

  const delivered: { status: string; message: string }[] = [];
  kobe.bus.subscribe('applicant', applicant.id, (event) => {
    if (event.type === 'application_status_changed') delivered.push(event.payload as { status: string; message: string });
  });

  kobe.employer.shortlist(employerId, outcome.application.id, { kind: 'employer', id: employerId }, null);

  assert.equal(delivered.length, 1);
  assert.equal(delivered[0]?.status, 'shortlisted');
  assert.equal(delivered[0]?.message, 'You have been shortlisted.');

  const tracker = kobe.swipe.tracker(applicant.id);
  assert.equal(tracker[0]?.statusLabel, 'Shortlisted');
  assert.equal(tracker[0]?.step, 2);
});

test('filling the last position closes the job for everyone', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { job, employerId } = await publish(kobe, {
    text: 'Job title: Head Chef\nLocation: Zanzibar\nSalary: USD 500 per month\nPositions: 1',
  });
  const { applicant } = makeApplicant(kobe);
  const actor: Actor = { kind: 'employer', id: employerId };

  const outcome = applyTo(kobe, applicant.id, job.id);
  assert.equal(outcome.result, 'applied');
  if (outcome.result !== 'applied') return;

  kobe.employer.shortlist(employerId, outcome.application.id, actor, null);
  kobe.employer.markHired(employerId, outcome.application.id, actor, 'Starts Monday');

  assert.equal(kobe.store.getJob(job.id)?.status, 'filled');
  assert.equal(kobe.store.jobStats(job.id)?.remainingPositions, 0);
  assert.equal(kobe.swipe.feed(makeApplicant(kobe).applicant.id).length, 0);
});

test('the status flow refuses shortcuts and the wrong actors', () => {
  assert.equal(canTransition('applied', 'viewed', 'employer').ok, true);
  assert.equal(canTransition('applied', 'hired', 'employer').ok, false);
  assert.equal(canTransition('shortlisted', 'interview', 'employer').ok, true);
  assert.equal(canTransition('shortlisted', 'viewed', 'employer').ok, false);
  assert.equal(canTransition('hired', 'rejected', 'employer').ok, false);
  assert.equal(canTransition('applied', 'shortlisted', 'applicant').ok, false);
  assert.equal(canTransition('applied', 'withdrawn', 'applicant').ok, true);
  assert.equal(canTransition('interview', 'hired', 'agency').ok, true);
});

test('an invalid transition is refused by the service too', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { job, employerId } = await publish(kobe);
  const { applicant } = makeApplicant(kobe);
  const outcome = applyTo(kobe, applicant.id, job.id);
  assert.equal(outcome.result, 'applied');
  if (outcome.result !== 'applied') return;

  assert.throws(
    () => kobe.employer.transition(employerId, outcome.application.id, 'hired', { kind: 'employer', id: employerId }, null),
    /Cannot move an application from Applied to Hired/,
  );
});

test('one client can never reach another client’s candidates', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const zanzibar = await publish(kobe);
  const school = await publish(kobe, {
    employerName: 'Mwanga Private School',
    text: 'Job title: Teacher\nLocation: Arusha\nSalary: TSh 700,000 per month\nPositions: 2',
  });

  const { applicant } = makeApplicant(kobe);
  const outcome = applyTo(kobe, applicant.id, zanzibar.job.id);
  assert.equal(outcome.result, 'applied');
  if (outcome.result !== 'applied') return;

  assert.equal(kobe.employer.candidates(school.employerId).length, 0);
  assert.throws(
    () => kobe.employer.openCandidate(school.employerId, outcome.application.id, { kind: 'employer', id: school.employerId }),
    /Application not found/,
  );
  assert.throws(() => kobe.employer.job(school.employerId, zanzibar.job.id), /Job not found/);
});

test('employers can filter their candidate list', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { job, employerId } = await publish(kobe);
  const neema = makeApplicant(kobe, { fullName: 'Neema Joseph', location: 'Dar es Salaam' });
  const asha = makeApplicant(kobe, { fullName: 'Asha Mwinyi', location: 'Zanzibar' });
  applyTo(kobe, neema.applicant.id, job.id);
  applyTo(kobe, asha.applicant.id, job.id);

  assert.equal(kobe.employer.candidates(employerId).length, 2);
  assert.equal(kobe.employer.candidates(employerId, { location: 'Zanzibar' })[0]?.applicant.fullName, 'Asha Mwinyi');
  assert.equal(kobe.employer.candidates(employerId, { search: 'neema' })[0]?.applicant.fullName, 'Neema Joseph');
  assert.equal(kobe.employer.candidates(employerId, { status: 'applied' }).length, 2);
  assert.equal(kobe.employer.candidates(employerId, { jobId: job.id }).length, 2);
});

test('candidate cards carry the relocation note the employer needs', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { job, employerId } = await publish(kobe);
  const away = makeApplicant(kobe, { location: 'Dar es Salaam', willingToRelocate: true });
  applyTo(kobe, away.applicant.id, job.id);

  assert.equal(kobe.employer.candidates(employerId)[0]?.relocation, 'Ready to relocate');
});

test('the agency table shows every client, job and count', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { job, employerId } = await publish(kobe);
  const { applicant } = makeApplicant(kobe);
  const outcome = applyTo(kobe, applicant.id, job.id);
  assert.equal(outcome.result, 'applied');
  if (outcome.result !== 'applied') return;

  kobe.employer.shortlist(employerId, outcome.application.id, { kind: 'agency', id: 'staff_amina' }, 'Called her');

  const rows = kobe.agency.overview();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.employerName, 'Zanzibar Resort');
  assert.equal(rows[0]?.jobTitle, 'Hotel Attendant');
  assert.equal(rows[0]?.applications, 1);
  assert.equal(rows[0]?.shortlisted, 1);

  const summary = kobe.agency.summary();
  assert.deepEqual(summary, { clients: 1, jobs: 1, applications: 1, shortlisted: 1, hired: 0 });
});

test('missed dashboard events can be replayed after a reconnect', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { job, employerId } = await publish(kobe);
  const { applicant } = makeApplicant(kobe);
  applyTo(kobe, applicant.id, job.id);

  const all = kobe.bus.replay('employer', employerId, 0);
  assert.ok(all.length >= 2);
  assert.equal(kobe.bus.replay('employer', employerId, all[0]?.id ?? 0).length, all.length - 1);
});
