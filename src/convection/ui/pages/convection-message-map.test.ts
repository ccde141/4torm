import assert from 'node:assert/strict';
import test from 'node:test';
import { convectionReasoningProps, restoreConvectionMessage } from './convection-message-map.js';

test('对流会话重载保留 reasoning 与工具结果', () => {
  assert.deepEqual(restoreConvectionMessage({
    speaker: 'Agent A',
    content: '结论',
    rawContent: '<answer>结论</answer>',
    reasoning: '思考过程',
    timestamp: 1,
    toolCalls: [{ tool: 'read_file', args: { path: 'a' }, result: 'ok' }],
  }), {
    speaker: 'Agent A',
    content: '结论',
    rawContent: '<answer>结论</answer>',
    reasoning: '思考过程',
    timestamp: new Date(1).toISOString(),
    toolCalls: [{ tool: 'read_file', args: { path: 'a' }, result: 'ok', status: 'done' }],
  });
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
