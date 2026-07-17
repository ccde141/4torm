import assert from 'node:assert/strict';
import test from 'node:test';
import { appendConvectionReasoning, buildConvectionMessage } from './convection-reasoning.js';

test('对流 reasoning 分片累积后写入最终消息', () => {
  const reasoning = appendConvectionReasoning('分析一', '分析二');
  assert.deepEqual(buildConvectionMessage({
    speaker: 'Agent A',
    content: '结论',
    rawContent: '<answer>结论</answer>',
    reasoning,
    toolCalls: [],
    timestamp: 1,
  }), {
    speaker: 'Agent A',
    content: '结论',
    rawContent: '<answer>结论</answer>',
    reasoning: '分析一分析二',
    timestamp: 1,
  });
});
