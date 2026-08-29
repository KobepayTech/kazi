import assert from 'node:assert/strict';
import test from 'node:test';
import { applicationDocumentBundle, requiredApplicationDocuments } from '../src/domain/documents.ts';
import { applyTo, makeApplicant, makeHarness, publish } from './helpers.ts';

test('an application is submitted with a 24-hour checklist when documents are missing', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { job } = await publish(kobe, {
    employerName: 'City Logistics',
    text: [
      'Job title: Truck Driver',
      'Location: Dar es Salaam',
      'Positions: 3',
      'Salary: TSh 700,000 per month',
      'Certificate required',
      'Requirements:',
      'Class C driving licence',
    ].join('\n'),
  });
  const { applicant } = makeApplicant(kobe, { categories: ['driving'], planCode: 'certificate' });

  const outcome = applyTo(kobe, applicant.id, job.id);
  assert.equal(outcome.result, 'applied');
  if (outcome.result !== 'applied') return;

  assert.equal(outcome.documents.complete, false);
  assert.deepEqual(
    outcome.documents.documents.map((doc) => [doc.kind, doc.satisfied]),
    [['cv', true], ['photo', false], ['licence', false]],
  );
  assert.equal(
    new Date(outcome.documents.dueAt).getTime() - new Date(outcome.application.createdAt).getTime(),
    24 * 60 * 60 * 1000,
  );
});

test('adding a photo and licence automatically completes existing applications for applicant and employer', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const published = await publish(kobe, {
    employerName: 'City Logistics',
    text: [
      'Job title: Truck Driver',
      'Location: Dar es Salaam',
      'Positions: 3',
      'Salary: TSh 700,000 per month',
      'Certificate required',
      'Requirements:',
      'Class C driving licence',
    ].join('\n'),
  });
  const { applicant } = makeApplicant(kobe, { categories: ['driving'], planCode: 'certificate' });
  const outcome = applyTo(kobe, applicant.id, published.job.id);
  assert.equal(outcome.result, 'applied');
  if (outcome.result !== 'applied') return;

  kobe.applicants.updateProfile(applicant.id, { photoPath: '/uploads/photo.jpg' });
  kobe.applicants.addDocument(applicant.id, {
    kind: 'licence',
    label: 'Class C driving licence',
    filePath: '/uploads/licence.pdf',
    filename: 'licence.pdf',
    contentType: 'application/pdf',
  });

  const tracked = kobe.swipe.tracker(applicant.id)[0];
  assert.equal(tracked?.documents.complete, true);
  assert.equal(tracked?.documents.satisfiedCount, 3);

  const candidate = kobe.employer.candidates(published.employerId)[0];
  assert.equal(candidate?.documents.complete, true);
  assert.equal(candidate?.documents.documents.find((doc) => doc.kind === 'photo')?.filePath, '/uploads/photo.jpg');
  assert.equal(candidate?.documents.documents.find((doc) => doc.kind === 'licence')?.filePath, '/uploads/licence.pdf');
});

test('an uploaded CV becomes the CV file sent with applications while Kazi can still generate tailored text', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const published = await publish(kobe);
  const { applicant } = makeApplicant(kobe);

  kobe.applicants.updateProfile(applicant.id, { photoPath: '/uploads/photo.jpg' });
  const uploaded = kobe.applicants.addDocument(applicant.id, {
    kind: 'cv',
    label: 'My CV',
    filePath: '/uploads/my-cv.pdf',
    filename: 'my-cv.pdf',
    contentType: 'application/pdf',
  });

  const outcome = applyTo(kobe, applicant.id, published.job.id);
  assert.equal(outcome.result, 'applied');
  if (outcome.result !== 'applied') return;

  const cvItem = outcome.documents.documents.find((doc) => doc.kind === 'cv');
  assert.equal(cvItem?.satisfied, true);
  assert.equal(cvItem?.source, 'uploaded_document');
  assert.equal(cvItem?.uploadedDocumentId, uploaded.id);
  assert.equal(cvItem?.filePath, '/uploads/my-cv.pdf');
  assert.match(outcome.applicationPackage.tailoredCvText, /NEEMA JOSEPH/i);
});

test('certificate and identity requirements are inferred conservatively from the vacancy', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const { job } = await publish(kobe, {
    employerName: 'Clinic',
    text: [
      'Job title: Nurse',
      'Location: Dar es Salaam',
      'Positions: 2',
      'Salary: TSh 900,000 per month',
      'Certificate required',
      'Requirements:',
      'Nursing certificate',
      'NIDA or passport',
    ].join('\n'),
  });

  assert.deepEqual(
    requiredApplicationDocuments(job).map((doc) => doc.kind),
    ['cv', 'photo', 'certificate', 'identity'],
  );
});

test('document bundle becomes overdue only when incomplete after its due time', async (t) => {
  const { kobe, close } = makeHarness();
  t.after(close);

  const published = await publish(kobe);
  const { applicant } = makeApplicant(kobe);
  const outcome = applyTo(kobe, applicant.id, published.job.id);
  assert.equal(outcome.result, 'applied');
  if (outcome.result !== 'applied') return;

  const cv = kobe.store.getCv(outcome.application.cvId);
  assert.ok(cv);
  const afterDeadline = new Date(new Date(outcome.application.createdAt).getTime() + 25 * 60 * 60 * 1000);
  const bundle = applicationDocumentBundle({
    application: outcome.application,
    job: published.job,
    applicant,
    cv,
    documents: [],
    now: afterDeadline,
  });
  assert.equal(bundle.complete, false);
  assert.equal(bundle.overdue, true);
  assert.equal(bundle.remainingMs, 0);
});
