import assert from 'node:assert/strict';
import test from 'node:test';
import { runReActLoopNative } from './react-loop.js';

test('cyclone native loop preserves answer text emitted before tools', async () => {
  let call = 0;
  const result = await runReActLoopNative({
    messages: [{ role: 'system', content: 's' }],
    llm: {
      async call() {
        call++;
        if (call === 1) {
          return {
            content: 'Intermediate finding.',
            finishReason: 'tool_calls' as const,
            toolCalls: [{ id: 'read-1', name: 'read_file', arguments: '{}' }],
          };
        }
        return { content: 'Final sentence.', finishReason: 'stop' as const };
      },
    },
    tools: { call: async () => 'file contents' },
    toolDefs: [],
  });

  assert.equal(result.content, 'Intermediate finding.\n\nFinal sentence.');
  assert.equal(result.rawContent, 'Intermediate finding.\n\nFinal sentence.');
});
