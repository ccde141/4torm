import assert from 'node:assert/strict';
import test from 'node:test';
import { translateNativeLoopEvent } from './native-adapter.js';

test('native ReAct usage events forward actual usage and unknown', () => {
  const usage = { promptTokens: 41, completionTokens: 9, totalTokens: 50 };
  assert.deepEqual(translateNativeLoopEvent({ type: 'usage', usage }), { type: 'usage', usage });
  assert.deepEqual(translateNativeLoopEvent({ type: 'usage', usage: null }), { type: 'usage', usage: null });
});
