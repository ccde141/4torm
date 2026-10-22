import assert from 'node:assert/strict';
import test from 'node:test';
import { projectAgentNodeConversation } from './agent-node-view.js';

test('节点对话只投影有限的公开消息与未完成回复，不泄露系统词、思考和工具输出', () => {
  const result = projectAgentNodeConversation({
    messages: [
      { role: 'system', content: 'secret' },
      { role: 'user', content: '任务' },
      { role: 'assistant', content: '完成', reasoningContent: 'private' },
      { role: 'tool', content: 'raw tool log' },
    ],
    roundLog: [
      { type: 'reasoning', content: 'hidden' },
      { type: 'token', content: '正在' },
      { type: 'token', content: '处理' },
      { type: 'tool-result', tool: 'read_file', result: 'secret', ok: true },
    ],
    busy: true, runId: 'round-1', roundSource: 'human', lastSeq: 12,
  }, { workflowId: 'wf-1', executionId: 'exec-1', nodeId: 'node-1', limit: 1 });
  assert.deepEqual(result.messages, [{ role: 'assistant', content: '完成' }]);
  assert.equal(result.totalMessages, 2);
  assert.equal(result.hasEarlierMessages, true);
  assert.deepEqual(result.currentReply, { runId: 'round-1', source: 'human',
    content: '正在处理', complete: false });
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('空闲节点不伪造当前回复，长内容明确截断', () => {
  const result = projectAgentNodeConversation({ messages: [
    { role: 'user', content: 'a'.repeat(5000) },
  ], roundLog: [], busy: false, lastSeq: 1 },
  { workflowId: 'wf-1', executionId: 'exec-1', nodeId: 'node-1', limit: 8 });
  assert.equal(result.currentReply, null);
  assert.equal(result.messages[0].content.length, 4000);
  assert.equal(result.messages[0].truncated, true);
});

test('已暂停交付轮公开 pausedRunId，不冒充正在输出的普通发话轮', () => {
  const result = projectAgentNodeConversation({ messages: [], roundLog: [], busy: true,
    paused: true, pausedRunId: 'envelope-round', runId: 'message-round', roundSource: 'human', lastSeq: 5 },
  { workflowId: 'wf', executionId: 'exec', nodeId: 'writer', limit: 8 });
  assert.equal(result.pausedRunId, 'envelope-round');
  assert.equal(result.currentReply?.runId, 'message-round');
});
