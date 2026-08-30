import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function inlineScript(path: string): string {
  const html = readFileSync(new URL(path, import.meta.url), 'utf8');
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  const script = match?.[1];
  if (script === undefined) throw new Error(`No inline script in ${path}`);
  return script;
}

test('subscription paywall and admin subscriber pages compile', () => {
  const applicantHtml = readFileSync(new URL('../src/web/swipe.html', import.meta.url), 'utf8');
  const adminHtml = readFileSync(new URL('../src/web/agency.html', import.meta.url), 'utf8');

  assert.doesNotThrow(() => new Function(inlineScript('../src/web/swipe.html')));
  assert.doesNotThrow(() => new Function(inlineScript('../src/web/agency.html')));

  assert.match(applicantHtml, /Subscription required/);
  assert.match(applicantHtml, /Jobs are locked/);
  assert.match(adminHtml, /id="subscribers"/);
  assert.match(adminHtml, /Active subscribers/);
  assert.match(adminHtml, /data-copy-client/);
});
