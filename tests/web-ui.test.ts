import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('applicant page script compiles and exposes clickable document-alert hooks', () => {
  const html = readFileSync(new URL('../src/web/swipe.html', import.meta.url), 'utf8');
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  const script = match?.[1];
  if (script === undefined) throw new Error('swipe page must contain an inline script');

  // Compile only: browser globals are intentionally not executed in Node.
  assert.doesNotThrow(() => new Function(script));

  assert.match(html, /id="documentAlertJump"/);
  assert.match(html, /data-document-panel=/);
  assert.match(html, /function jumpToMissingDocuments/);
  assert.match(html, /scrollIntoView\(\{ behavior: 'smooth'/);
});
