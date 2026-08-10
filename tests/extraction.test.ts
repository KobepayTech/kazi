import test from 'node:test';
import assert from 'node:assert/strict';
import { AssistedExtractor, RuleBasedExtractor, parseBooleanish } from '../src/domain/extraction.ts';
import { formatSalaryLine, parseSalary, toMonthlyTzs } from '../src/domain/salary.ts';
import { ZANZIBAR_POSTER } from './helpers.ts';

const extractor = new RuleBasedExtractor();

test('reads the Zanzibar hotel poster the way the workflow describes', () => {
  const { vacancy } = extractor.extract(ZANZIBAR_POSTER);

  assert.equal(vacancy.title, 'Hotel Attendant');
  assert.equal(vacancy.location, 'Zanzibar');
  assert.equal(vacancy.category, 'hospitality');
  assert.equal(vacancy.positions, 8);
  assert.equal(vacancy.accommodationProvided, true);
  assert.equal(vacancy.genderRequirement, 'female');
  assert.equal(vacancy.ageMin, 18);
  assert.equal(vacancy.ageMax, 35);
  assert.deepEqual(vacancy.languages, ['English']);
  assert.equal(vacancy.immediateStart, true);
  assert.match(vacancy.experienceNote ?? '', /hospitality experience/i);

  assert.equal(vacancy.salary?.currency, 'USD');
  assert.equal(vacancy.salary?.amountMin, 200);
  assert.equal(vacancy.salary?.period, 'month');
  assert.equal(vacancy.salary?.plusTips, true);
});

test('spells out the number of positions written as a word', () => {
  const { vacancy } = extractor.extract('We require eight female hotel attendants.');
  assert.equal(vacancy.positions, 8);
  assert.equal(vacancy.title, 'Hotel Attendant');
});

test('reads a Swahili poster', () => {
  const { vacancy, detectedLanguage } = extractor.extract(
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
  assert.equal(vacancy.positions, 15);
  assert.equal(vacancy.location, 'Dar es Salaam');
  assert.equal(vacancy.category, 'driving');
  assert.equal(vacancy.salary?.amountMin, 600_000);
  assert.equal(vacancy.salary?.currency, 'TZS');
  assert.equal(vacancy.experienceYearsMin, 3);
  assert.equal(vacancy.accommodationProvided, true);
  assert.equal(vacancy.immediateStart, true);
});

test('labelled lines beat guesses, and every value keeps its evidence', () => {
  const result = extractor.extract(['Job title: Night Auditor', 'Location: Stone Town', 'Positions: 3'].join('\n'));
  assert.equal(result.vacancy.title, 'Night Auditor');

  const titleConfidence = result.confidence.find((entry) => entry.field === 'title');
  assert.ok(titleConfidence);
  assert.ok(titleConfidence.confidence >= 0.9);
  assert.equal(titleConfidence.evidence, 'Job title: Night Auditor');
});

test('flags low-confidence and missing fields for staff to check', () => {
  const result = extractor.extract('Tunahitaji wafanyakazi.');
  assert.ok(result.needsReview.includes('salary'));
  assert.ok(result.needsReview.includes('location'));
  // Assumed defaults are flagged too, so nothing silently invents a value.
  assert.ok(result.needsReview.includes('employmentType'));
});

test('a stated diploma implies the vacancy needs a certificate package', () => {
  const { vacancy } = extractor.extract('Job title: Accountant\nEducation: Diploma in accounting\nLocation: Mwanza');
  assert.equal(vacancy.educationMin, 'diploma');
  assert.equal(vacancy.certificateRequired, true);
});

test('an explicit "no certificate" wins over any qualification wording', () => {
  const { vacancy } = extractor.extract('Shop attendant needed. No certificate required. Location: Arusha');
  assert.equal(vacancy.certificateRequired, false);
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
  // The low end is what an applicant's minimum-salary filter compares against.
  assert.equal(salary?.monthlyTzs, 450_000);
});

test('formats the pay line shown on the swipe card', () => {
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

test('an assisted extractor may fill blanks but never overwrites a labelled value', async () => {
  const assisted = new AssistedExtractor(async () =>
    JSON.stringify({ title: 'Something Else', employerName: 'Zanzibar Resort', mealsProvided: true }),
  );
  const result = await assisted.extract(`Job title: Hotel Attendant\n${ZANZIBAR_POSTER}`);

  // The poster states the title on a labelled line, so the model cannot move it.
  assert.equal(result.vacancy.title, 'Hotel Attendant');
  // These two the poster never stated, so the model's reading is accepted.
  assert.equal(result.vacancy.employerName, 'Zanzibar Resort');
  assert.equal(result.vacancy.mealsProvided, true);
});

test('a failing model falls back to the rule-based reading', async () => {
  const assisted = new AssistedExtractor(async () => {
    throw new Error('model unavailable');
  });
  const result = await assisted.extract(ZANZIBAR_POSTER);
  assert.equal(result.vacancy.title, 'Hotel Attendant');
  assert.equal(result.extractor, 'kobe-rules-v1');
});
