import assert from 'node:assert/strict';
import test from 'node:test';
import { projectAgentMeetingConversation } from './agent-meeting-view.js';

test('会议公开记录只含发言内容，流式片段明确未完成', () => {
  const result = projectAgentMeetingConversation({
    workflowId: 'wf-1', executionId: 'exec-1', nodeId: 'meeting', scope: 'public', limit: 2,
    round: 3, phase: 'discussion', busy: true,
    messages: [
      { speaker: 'A', content: '早', timestamp: 1, reasoning: 'private' },
      { speaker: 'B', content: '中', timestamp: 2, toolCalls: [{ tool: 'x', result: 'secret' }] },
      { speaker: 'C', content: '晚', timestamp: 3 },
    ],
    streamingCurrent: { speaker: 'D', content: '正在线上', reasoning: 'hidden' },
  });
  assert.deepEqual(result.messages.map(message => message.content), ['中', '晚']);
  assert.equal(result.hasEarlierMessages, true);
  assert.deepEqual(result.currentMessage, { speaker: 'D', content: '正在线上', complete: false });
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('会长私聊按独立范围返回且忽略系统词、思考与工具消息', () => {
  const result = projectAgentMeetingConversation({
    workflowId: 'wf-1', executionId: 'exec-1', nodeId: 'meeting', scope: 'chair', limit: 8,
    round: 2, phase: 'discussion', busy: false,
    messages: [
      { role: 'system', content: 'secret' },
      { role: 'user', content: '请点评' },
      { role: 'assistant', content: '意见', reasoningContent: 'private' },
      { role: 'tool', content: 'hidden' },
    ],
  });
  assert.deepEqual(result.messages, [
    { role: 'user', content: '请点评' }, { role: 'assistant', content: '意见' },
  ]);
  assert.equal(result.currentMessage, null);
});
