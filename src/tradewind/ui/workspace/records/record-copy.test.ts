import assert from 'node:assert/strict';
import test from 'node:test';
import { previewLabel } from './record-copy';

test('long event previews still display the recorded handoff direction', () => {
  assert.equal(previewLabel('{"executionId":"long...', { source: 'review', target: 'make' }), 'review → make');
  assert.equal(previewLabel('{"executionId":"long...'), '');
  assert.equal(previewLabel('历史备注'), '历史备注');
  assert.equal(previewLabel('{"source":"a","target":"b"}'), 'a → b');
});
