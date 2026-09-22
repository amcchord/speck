import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createViewScope, StaleViewError, loadingState } from '../src/loading.ts';

test('a late response cannot replace a newer view, even after navigating back', async () => {
  const view = createViewScope();
  let release;
  const first = (async () => {
    const current = view.checkpoint();
    await new Promise(resolve => release = resolve);
    current();
    return 'old page';
  })();
  view.reset();
  view.reset();
  const current = view.checkpoint();
  release();
  await assert.rejects(first, StaleViewError);
  assert.doesNotThrow(current);
});
test('loading labels cannot inject markup and announce a status', () => {
  const html = loadingState('<img onerror="bad">', 'A & B');
  assert.ok(html.includes('role="status"'));
  assert.ok(html.includes('&lt;img onerror=&quot;bad&quot;&gt;'));
  assert.ok(html.includes('A &amp; B'));
  assert.ok(!html.includes('<img onerror'));
});
