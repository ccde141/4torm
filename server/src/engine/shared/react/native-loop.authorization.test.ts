import assert from 'node:assert/strict';
import test from 'node:test';
import { runReActLoopNative } from './native-loop.js';

test('native loop refuses a tool that was not offered this turn', async () => {
  let modelCalls = 0;
  let executions = 0;
  const result = await runReActLoopNative({
    messages: [{ role: 'user', content: 'write' }],
    llm: {
      call: async () => (++modelCalls === 1
        ? {
            content: '', finishReason: 'tool_calls' as const,
            toolCalls: [{ id: 'forbidden-1', name: 'write_file', arguments: '{}' }],
          }
        : { content: 'Permission denied.', finishReason: 'stop' as const }),
    },
    tools: { call: async () => { executions++; return 'unexpected'; } },
    toolDefs: [{ name: 'read_file', description: 'read', parameters: { type: 'object' } }],
  });

  assert.equal(executions, 0);
  assert.equal(result.content, 'Permission denied.');
  assert.match(String(result.toolCalls[0]?.result), /未在本轮授权/);
});
