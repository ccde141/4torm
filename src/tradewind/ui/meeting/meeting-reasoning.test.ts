import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendChairStreamChunk,
  appendReasoning,
  applyChairStreamSnapshot,
  combineReasoning,
} from './meeting-reasoning.js';

test('chair token and reasoning stay in separate fields', () => {
  const initial = { content: '', reasoning: '' };
  const withReasoning = appendChairStreamChunk(initial, 'chair-reasoning', 'private thought');
  const complete = appendChairStreamChunk(withReasoning, 'chair-token', 'public answer');

  assert.deepEqual(complete, {
    content: 'public answer',
    reasoning: 'private thought',
  });
});

test('会议 reasoning 分片按顺序累积', () => {
  assert.equal(appendReasoning('第一段', '第二段'), '第一段第二段');
});

test('原生 reasoning 与文本 think 都保留且不重复', () => {
  assert.equal(combineReasoning('原生思考', '标签思考'), '原生思考\n\n标签思考');
  assert.equal(combineReasoning('相同思考', '相同思考'), '相同思考');
});

test('会长流定稿同时保留正文与独立思考', () => {
  const messages = applyChairStreamSnapshot(
    [{ role: 'user', content: '审阅会议' }, { role: 'assistant', content: '' }],
    '这是回复',
    '这是思考',
  );

  assert.deepEqual(messages[1], {
    role: 'assistant',
    content: '这是回复',
    reasoningContent: '这是思考',
  });
});
