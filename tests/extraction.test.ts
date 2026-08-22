import test from 'node:test';
import assert from 'node:assert/strict';
import { AssistedExtractor, RuleBasedExtractor, parseBooleanish } from '../src/domain/extraction.ts';
import { formatSalaryLine, parseSalary, toMonthlyTzs } from '../src/domain/salary.ts';
import { ZANZIBAR_POSTER } from './helpers.ts';

const extractor = new RuleBasedExtractor();

test('reads the Zanzibar hotel poster', () => {
  const { job } = extractor.extract(ZANZIBAR_POSTER);

  assert.equal(job.title, 'Hotel Attendant');
  assert.equal(job.location, 'Zanzibar');
  assert.equal(job.category, 'hospitality');
  assert.equal(job.positions, 8);
  assert.equal(job.accommodationProvided, true);
  assert.equal(job.immediateStart, true);
  assert.deepEqual(job.languages, ['English']);
  assert.equal(job.salary?.currency, 'USD');
  assert.equal(job.salary?.amountMin, 200);
  assert.equal(job.salary?.period, 'month');
  assert.equal(job.salary?.plusTips, true);
});

test('keeps the poster requirements as a list for the detail page', () => {
  const { job } = extractor.extract(ZANZIBAR_POSTER);
  const text = job.requirements.join(' | ').toLowerCase();
  assert.match(text, /english required/);
  assert.match(text, /hospitality experience preferred/);
  // The banner line is furniture, not a requirement.
  assert.ok(!text.includes('ajira exclusive'));
});

test('spells out a positions count written as a word', () => {
  const { job } = extractor.extract('We require eight female hotel attendants.');
  assert.equal(job.positions, 8);
  assert.equal(job.title, 'Hotel Attendant');
});

test('reads a Swahili poster', () => {
  const { job, detectedLanguage } = extractor.extract(
    [
      'Tunahitaji madereva 15 wa malori.',
      'Eneo: Dar es Salaam',
      'Mshahara: TSh 600,000 kwa mwezi',
      'Uzoefu: miaka 3 ya kuendesha malori',
      'Chakula na malazi hutolewa safarini',
      'Anza mara moja',
    ].join('\n'),
  );

  assert.equal(detectedLanguage, 'sw');
  assert.equal(job.positions, 15);
  assert.equal(job.location, 'Dar es Salaam');
  assert.equal(job.category, 'driving');
  assert.equal(job.salary?.amountMin, 600_000);
  assert.equal(job.salary?.currency, 'TZS');
  assert.equal(job.accommodationProvided, true);
  assert.equal(job.immediateStart, true);
});

test('splits responsibilities, requirements and contact details into sections', () => {
  const { job } = extractor.extract(
    [
      'Job title: Call Centre Agent',
      'Location: Dar es Salaam',
      'Salary: TSh 450,000 per month',
      'Responsibilities:',
      'Answer customer calls',
      'Log every complaint',
      'Requirements:',
      'Form four and above',
      'Contact: 0777 000 111',
    ].join('\n'),
  );

  assert.deepEqual(job.responsibilities, ['Answer customer calls', 'Log every complaint']);
  assert.ok(job.requirements.includes('Form four and above'));
  assert.match(job.contactInfo ?? '', /0777 000 111/);
});

test('a labelled line beats a guess, and keeps the evidence for the review screen', () => {
  const result = extractor.extract(['Job title: Night Auditor', 'Location: Stone Town', 'Positions: 3'].join('\n'));
  assert.equal(result.job.title, 'Night Auditor');
  assert.equal(result.job.positions, 3);

  const titleConfidence = result.confidence.find((entry) => entry.field === 'title');
  assert.ok(titleConfidence);
  assert.ok(titleConfidence.confidence >= 0.9);
  assert.equal(titleConfidence.evidence, 'Job title: Night Auditor');
});

test('flags what a human should check before publishing', () => {
  const result = extractor.extract('Tunahitaji wafanyakazi.');
  assert.ok(result.needsReview.includes('salary'));
  assert.ok(result.needsReview.includes('location'));
});

test('a licence requirement means the job needs a certificate package', () => {
  const { job } = extractor.extract('Driver needed. Location: Mwanza. Salary: TSh 600,000. Leseni daraja C inahitajika.');
  assert.equal(job.certificateRequired, true);
});

test('an explicit "no certificate" wins over any qualification wording', () => {
  const { job } = extractor.extract('Shop attendant needed. No certificate required. Location: Arusha');
  assert.equal(job.certificateRequired, false);
});

test('does not read an age range as a salary', () => {
  assert.equal(parseSalary('Umri: miaka 18-35'), null);
  assert.equal(parseSalary('Age: 18 to 35 years'), null);
});

test('normalises pay to a monthly TZS figure for filtering', () => {
  assert.equal(toMonthlyTzs(200, 'USD', 'month'), 520_000);
  assert.equal(toMonthlyTzs(30_000, 'TZS', 'day'), 780_000);

  const salary = parseSalary('Salary: TSh 450,000 - 600,000 per month');
  assert.equal(salary?.amountMin, 450_000);
  assert.equal(salary?.amountMax, 600_000);
  // The low end is what a minimum-salary filter compares against.
  assert.equal(salary?.monthlyTzs, 450_000);
});

test('a k or m suffix only counts when it is attached to the digits', () => {
  assert.equal(parseSalary('Mshahara: TSh 600,000 kwa mwezi')?.amountMin, 600_000);
  assert.equal(parseSalary('Salary 450k per month')?.amountMin, 450_000);
});

test('formats the pay line printed on the card', () => {
  const salary = parseSalary('Salary: USD 200 plus tips');
  assert.ok(salary);
  assert.equal(formatSalaryLine(salary), 'USD 200 per month + tips');
});

test('reads provided/not provided wording, negatives first', () => {
  assert.equal(parseBooleanish('provided'), true);
  assert.equal(parseBooleanish('yanatolewa'), true);
  assert.equal(parseBooleanish('not provided'), false);
  assert.equal(parseBooleanish('hakuna malazi'), false);
  assert.equal(parseBooleanish('maybe'), null);
});

test('an assisted extractor fills blanks but never overrides a labelled value', async () => {
  const assisted = new AssistedExtractor(async () =>
    JSON.stringify({ title: 'Something Else', employerName: 'Zanzibar Resort' }),
  );
  const result = await assisted.extract(`Job title: Hotel Attendant\n${ZANZIBAR_POSTER}`);

  assert.equal(result.job.title, 'Hotel Attendant');
  assert.equal(result.job.employerName, 'Zanzibar Resort');
});

test('a failing model falls back to the rule-based reading', async () => {
  const assisted = new AssistedExtractor(async () => {
    throw new Error('model unavailable');
  });
  const result = await assisted.extract(ZANZIBAR_POSTER);
  assert.equal(result.job.title, 'Hotel Attendant');
  assert.equal(result.extractor, 'kobe-rules-v1');
});
