import assert from 'node:assert/strict';
import test from 'node:test';
import { translateNativeLoopEvent } from './native-adapter.js';

test('Tradewind native adapter 保留 reasoning 事件', () => {
  assert.deepEqual(
    translateNativeLoopEvent({ type: 'reasoning', chunk: '原生思考' }),
    { type: 'reasoning', content: '原生思考' },
  );
});

test('Tradewind native adapter 不在终态消费前重复推送错误', () => {
  assert.equal(translateNativeLoopEvent({ type: 'error', message: 'failed' }), undefined);
});
