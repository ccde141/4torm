import assert from 'node:assert/strict';
import test from 'node:test';
import { runReActLoop, SuspendSignal } from './react-loop.js';

test('cyclone text loop preserves ask suspension with JSON tool calls', async () => {
  const result = await runReActLoop({
    messages: [{ role: 'user', content: 'Need clarification.' }],
    llm: {
      call: async () => ({
        content: '{"type":"tool_call","name":"ask","arguments":{"question":"Which one?"}}',
        finishReason: 'stop',
      }),
    },
    tools: {
      call: async () => { throw new SuspendSignal('Which one?', ['A', 'B']); },
    },
  });

  assert.deepEqual(result.suspended, { question: 'Which one?', options: ['A', 'B'] });
  assert.equal(result.content, '');
});
