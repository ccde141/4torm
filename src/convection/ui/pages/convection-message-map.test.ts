import assert from 'node:assert/strict';
import test from 'node:test';
import { convectionReasoningProps, resolveConvectionAgent, restoreConvectionMessage } from './convection-message-map.js';

test('对流会话重载保留 reasoning 与工具结果', () => {
  assert.deepEqual(restoreConvectionMessage({
    agentId: 'agent-a',
    speaker: 'Agent A',
    content: '结论',
    rawContent: '<answer>结论</answer>',
    reasoning: '思考过程',
    timestamp: 1,
    toolCalls: [{ tool: 'read_file', args: { path: 'a' }, result: 'ok' }],
  }), {
    agentId: 'agent-a',
    speaker: 'Agent A',
    content: '结论',
    rawContent: '<answer>结论</answer>',
    reasoning: '思考过程',
    timestamp: new Date(1).toISOString(),
    toolCalls: [{ tool: 'read_file', args: { path: 'a' }, result: 'ok', status: 'done' }],
  });
});

test('对流消息优先按 agentId 解析，名称只兼容旧消息且拒绝重名', () => {
  const agents = [
    { id: 'agent-a', name: '新名字' },
    { id: 'agent-b', name: '重名' },
    { id: 'agent-c', name: '重名' },
  ];

  assert.equal(resolveConvectionAgent(agents, '旧名字', 'agent-a')?.id, 'agent-a');
  assert.equal(resolveConvectionAgent(agents, '新名字')?.id, 'agent-a');
  assert.equal(resolveConvectionAgent(agents, '重名'), undefined);
});

test('对流思考在流式与完成态使用一致的展示数据', () => {
  assert.deepEqual(convectionReasoningProps('分析过程', true), {
    reasoning: '分析过程', isStreaming: true,
  });
  assert.deepEqual(convectionReasoningProps('分析过程', false), {
    reasoning: '分析过程', isStreaming: false,
  });
  assert.equal(convectionReasoningProps('', false), undefined);
});
