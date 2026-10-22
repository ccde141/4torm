import assert from 'node:assert/strict';
import test from 'node:test';
import { execToolUnifiedOutcome } from './exec-tool.js';
import { runReActLoopNative, type LLMCaller } from './react/native-loop.js';
import { runReActLoop } from './react/text-loop.js';
import type { ContextMessage } from './types.js';

for (const mode of ['native', 'text'] as const) {
  test(`${mode} keeps JSON argument types through execution and recorded history`, async () => {
    const args = { viewport: { width: 1280, height: 720 }, tabs: ['one', 'two'],
      count: 2, enabled: false, nullable: null, text: 'false' };
    const tool = 'mcp:fixture:inspect';
    const messages: ContextMessage[] = [{ role: 'user', content: 'Inspect this fixture.' }];
    const received: Array<Record<string, unknown>> = [];
    let requests = 0;
    const llm: LLMCaller = { call: async () => {
      if (++requests > 1) return { content: 'Complete.', finishReason: 'stop' };
      return mode === 'native'
        ? { content: '', finishReason: 'tool_calls',
          toolCalls: [{ id: 'fixture-call', name: tool, arguments: JSON.stringify(args) }] }
        : { content: JSON.stringify({ type: 'tool_call', name: tool, arguments: args }), finishReason: 'stop' };
    } };
    const params = { messages, llm, allowedTools: [tool], tools: {
      call: async (name: string, values: Record<string, unknown>) => execToolUnifiedOutcome({
        tool: name, args: values, agentId: 'fixture-agent',
      }, {
        callMcp: async () => { throw new Error('legacy outcome route must not run'); },
        callMcpOutcome: async (_name, values) => {
          received.push(values);
          return { result: 'inspected', ok: true };
        },
        fetcher: async () => { throw new Error('local route must not run'); },
      }),
    } };
    const result = mode === 'native'
      ? await runReActLoopNative({ ...params,
        toolDefs: [{ name: tool, description: 'Inspect fixture', parameters: { type: 'object' } }] })
      : await runReActLoop(params);

    assert.equal(result.termination.status, 'succeeded');
    assert.equal(requests, 2);
    assert.deepEqual(received, [args]);
    assert.deepEqual(JSON.parse(JSON.stringify(result.toolCalls[0].args)), args);
    const assistant = messages.find(message => message.toolCalls?.length
      || message.content.includes('"type":"tool_call"'))!;
    const raw = mode === 'native' ? assistant.toolCalls![0].arguments
      : JSON.stringify(JSON.parse(assistant.content).arguments);
    assert.deepEqual(JSON.parse(raw), args);
  });
}
