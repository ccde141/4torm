import assert from 'node:assert/strict';
import test from 'node:test';
import { appendReasoning, combineReasoning } from './meeting-reasoning.js';

test('会议 reasoning 分片按顺序累积', () => {
  assert.equal(appendReasoning('第一段', '第二段'), '第一段第二段');
});

test('原生 reasoning 与文本 think 都保留且不重复', () => {
  assert.equal(combineReasoning('原生思考', '标签思考'), '原生思考\n\n标签思考');
  assert.equal(combineReasoning('相同思考', '相同思考'), '相同思考');
});
