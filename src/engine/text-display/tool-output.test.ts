import assert from 'node:assert/strict';
import test from 'node:test';
import { toolOutputSummary } from './tool-output';

test('tool previews retain each existing blank-line counting convention', () => {
  assert.deepEqual(toolOutputSummary('\nalpha\n\nbeta\n'), { lines: 5, preview: '' });
  assert.deepEqual(toolOutputSummary('\nalpha\n\nbeta\n', true), { lines: 2, preview: 'alpha' });
  assert.deepEqual(toolOutputSummary(''), { lines: 1, preview: '' });
});

test('large results are summarized without copying every line into an array', () => {
  const source = 'x'.repeat(100_000) + '\n'.repeat(100_000);
  assert.deepEqual(toolOutputSummary(source), { lines: 100_001, preview: 'x'.repeat(60) });
});
