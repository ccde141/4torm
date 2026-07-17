import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreConvectionMessage } from './convection-message-map.js';

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
