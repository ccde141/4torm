import assert from 'node:assert/strict';
import test from 'node:test';
import { handoffReturnPath } from './handoff-return-path';

test('conditional return edges take a distinct arc; strict and forward edges keep existing paths', () => {
  assert.equal(handoffReturnPath('strict', 500, 200, 100, 200), undefined);
  assert.equal(handoffReturnPath(undefined, 500, 200, 100, 200), undefined);
  assert.equal(handoffReturnPath('handoff', 100, 200, 500, 200), undefined);
  const back = handoffReturnPath('handoff', 500, 200, 100, 200)!;
  assert.match(back, /^M 500 200 C/);
  assert.match(back, /100 200$/);
  assert.notEqual(back, 'M 500 200 L 100 200');
});
