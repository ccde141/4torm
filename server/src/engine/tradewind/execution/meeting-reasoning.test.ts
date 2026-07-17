import assert from 'node:assert/strict';
import test from 'node:test';
import { appendMeetingReasoning } from './meeting-reasoning.js';

test('会议思考流独立累积，不修改可见正文', () => {
  const message = { content: '正文', reasoning: '第一段' };
  appendMeetingReasoning(message, '第二段');
  assert.deepEqual(message, { content: '正文', reasoning: '第一段第二段' });
});
