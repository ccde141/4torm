import assert from 'node:assert/strict';
import test from 'node:test';
import { runReActLoop, type LLMCaller } from './react-loop.js';

test('Tradewind 文本 ReAct 将原生 reasoning 作为独立事件转发', async () => {
  const llm: LLMCaller = {
    async call(_messages, _options, onChunk, _signal, onReasoning) {
      onReasoning?.('内部分析');
      onChunk?.('<answer>完成</answer>');
      return { content: '<answer>完成</answer>', finishReason: 'stop' };
    },
  };
  const events: Array<{ type: string; chunk?: string }> = [];

  const result = await runReActLoop({
    messages: [{ role: 'user', content: '测试' }],
    llm,
    maxTurns: 1,
    onEvent: event => events.push(event),
  });

  assert.equal(result.content, '完成');
  assert.deepEqual(events.filter(event => event.type === 'reasoning'), [
    { type: 'reasoning', chunk: '内部分析' },
  ]);
});
