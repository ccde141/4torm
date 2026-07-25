import assert from 'node:assert/strict';
import test from 'node:test';
import { runReActLoop, type LLMCaller } from './react-loop.js';

test('Tradewind text loop preserves token usage and tool metadata', async () => {
  const replies = [
    '{"type":"tool_call","name":"inspect","arguments":{"path":"a.txt"}}',
    '检查完成',
  ];
  const llm: LLMCaller = {
    async call() {
      return {
        content: replies.shift() ?? '',
        finishReason: 'stop',
        usage: { promptTokens: replies.length ? 12 : 24, completionTokens: 3, totalTokens: 27 },
      };
    },
  };
  const events: Array<{ type: string; meta?: unknown }> = [];

  const result = await runReActLoop({
    messages: [{ role: 'user', content: '检查文件' }],
    llm,
    tools: {
      async call(_tool, _args, onMeta) {
        onMeta?.({ artifact: 'report.json' });
        return 'ok';
      },
    },
    onEvent: event => events.push(event),
  });

  assert.equal(result.content, '检查完成');
  assert.equal(result.lastPromptTokens, 24);
  assert.deepEqual(result.toolCalls[0]?.meta, { artifact: 'report.json' });
  assert.deepEqual(events.find(event => event.type === 'tool-result')?.meta, { artifact: 'report.json' });
});
