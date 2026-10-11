import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContextMessage } from '../types.js';
import { runReActLoopNative } from './native-loop.js';

test('native loop refuses a tool that was not offered this turn', async () => {
  let modelCalls = 0;
  let executions = 0;
  const resultEvents: Array<{ ok?: boolean }> = [];
  const messages: ContextMessage[] = [{ role: 'user', content: 'write' }];
  const result = await runReActLoopNative({
    messages,
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
    onEvent: event => { if (event.type === 'tool-result') resultEvents.push(event as { ok?: boolean }); },
  });

  assert.equal(executions, 0);
  assert.equal(result.content, 'Permission denied.');
  assert.match(String(result.toolCalls[0]?.result), /未在本轮授权/);
  assert.equal(resultEvents[0]?.ok, false);
  assert.equal((messages.find(message => message.role === 'tool') as ContextMessage &
    { toolOk?: boolean })?.toolOk, false);
});
