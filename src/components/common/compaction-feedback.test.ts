import assert from 'node:assert/strict';
import test from 'node:test';
import { compactionFeedbackEvent, compactionFeedbackMessage, visibleCompactionFeedback } from './compaction-feedback.js';

test('compaction feedback clears only on the persisted accepted-input fact', () => {
  assert.equal(compactionFeedbackEvent({ type: 'execution-start' }), undefined);
  assert.equal(compactionFeedbackEvent({ type: 'round-start' }), undefined);
  assert.equal(compactionFeedbackEvent({ type: 'agent-start' }), undefined);
  assert.equal(compactionFeedbackEvent({ type: 'usage', usage: { totalTokens: 20 } }), undefined);
  assert.equal(compactionFeedbackEvent({ type: 'usage', usage: null }), undefined);
  assert.equal(compactionFeedbackEvent({ type: 'input-accepted' }), null);
  assert.equal(compactionFeedbackEvent({ type: 'compaction-notice', message: '切换模型继续压缩' }), '切换模型继续压缩');
});

test('live feedback distinguishes an unaccepted request from acknowledged clearing and reload', () => {
  const stored = { message: '指定压缩模型离线，已切换' };
  assert.equal(visibleCompactionFeedback(undefined, stored), stored.message);
  assert.equal(visibleCompactionFeedback(null, stored), '');
  assert.equal(visibleCompactionFeedback('新的压缩失败', stored), '新的压缩失败');
  assert.equal(compactionFeedbackMessage(null), '');
  assert.equal(compactionFeedbackMessage({ message: 42 }), '');
  assert.equal(compactionFeedbackEvent({ type: 'compaction-notice', message: 42 }), undefined);
});
