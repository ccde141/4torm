import assert from 'node:assert/strict';
import test from 'node:test';
import { runReActLoopNative } from './native-loop.js';
import { runReActLoop } from './text-loop.js';
import { formatTextToolCall } from '../text-tool-protocol.js';

for (const native of [true, false]) {
  test(`${native ? 'native' : 'text'} main task keeps working past two hundred turns`, async () => {
    let requests = 0; let executions = 0;
    const params = { messages: [{ role: 'user' as const, content: 'finish the task' }],
      llm: { call: async () => {
        if (++requests === 212) return { content: 'complete', finishReason: 'stop' as const };
        return native
          ? { content: '', finishReason: 'tool_calls' as const, toolCalls: [{ id: `t${requests}`, name: 'work', arguments: '{}' }] }
          : { content: formatTextToolCall('work', {}), finishReason: 'stop' as const };
      } }, tools: { call: async () => { executions++; return 'progress'; } } };
    const result = native ? await runReActLoopNative({ ...params,
      toolDefs: [{ name: 'work', description: 'work', parameters: { type: 'object' } }] })
      : await runReActLoop({ ...params, allowedTools: ['work'] });
    assert.equal(result.termination.status, 'succeeded');
    assert.equal(result.content, 'complete'); assert.equal(requests, 212); assert.equal(executions, 211);
  });

  test(`${native ? 'native' : 'text'} continuous task still stops on human cancellation`, async () => {
    const controller = new AbortController(); let executions = 0;
    const params = { messages: [{ role: 'user' as const, content: 'work' }], signal: controller.signal,
      llm: { call: async () => native
        ? { content: '', finishReason: 'tool_calls' as const, toolCalls: [{ id: `t${executions}`, name: 'work', arguments: '{}' }] }
        : { content: formatTextToolCall('work', {}), finishReason: 'stop' as const } },
      tools: { call: async () => { if (++executions === 205) controller.abort(); return 'progress'; } } };
    const result = native ? await runReActLoopNative({ ...params,
      toolDefs: [{ name: 'work', description: 'work', parameters: { type: 'object' } }] })
      : await runReActLoop({ ...params, allowedTools: ['work'] });
    assert.equal(result.termination.status, 'aborted'); assert.equal(executions, 205);
  });
}
