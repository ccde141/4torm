import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTideRepeatCountInput } from './tide-form-values.js';

test('重复次数输入保留零，空输入才回退为永续', () => {
  assert.equal(parseTideRepeatCountInput('0'), 0);
  assert.equal(parseTideRepeatCountInput('1'), 1);
  assert.equal(parseTideRepeatCountInput('-1'), -1);
  assert.equal(parseTideRepeatCountInput(''), -1);
});
