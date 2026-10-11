import assert from 'node:assert/strict';
import test from 'node:test';
import type { TokenUsage } from '../llm-bridge.js';
import { runReActLoopNative, type ReActStreamEvent } from './native-loop.js';
import { runReActLoop } from './text-loop.js';

const firstUsage: TokenUsage = { promptTokens: 120, completionTokens: 20, totalTokens: 140 };
const secondUsage: TokenUsage = { promptTokens: 180, completionTokens: 25, totalTokens: 205 };

for (const name of ['native', 'text'] as const) {
  test(`${name} reports each completed model call before the ReAct turn finishes`, async () => {
    const events: ReActStreamEvent[] = [];
    let calls = 0;
    const llm = { call: async () => {
      calls++;
      return calls === 1
        ? { content: 'first part', finishReason: 'length' as const, usage: firstUsage }
        : { content: 'last part', finishReason: 'stop' as const, usage: secondUsage };
    } };
    const params = {
      messages: [{ role: 'user' as const, content: 'continue' }],
      llm,
      onEvent: (event: ReActStreamEvent) => events.push(event),
    };
    const result = name === 'native'
      ? await runReActLoopNative({ ...params, toolDefs: [] })
      : await runReActLoop(params);

    assert.equal(calls, 2);
    assert.deepEqual(events.filter(event => event.type === 'usage'), [
      { type: 'usage', usage: firstUsage },
      { type: 'usage', usage: secondUsage },
    ]);
    assert.deepEqual(result.usage, secondUsage);
  });

  test(`${name} clears the latest usage when the provider omits it`, async () => {
    const usages: Array<TokenUsage | null> = [];
    let calls = 0;
    const params = {
      messages: [{ role: 'user' as const, content: 'continue' }],
      llm: { call: async () => {
        calls++;
        return calls === 1
          ? { content: 'first part', finishReason: 'length' as const, usage: firstUsage }
          : { content: 'last part', finishReason: 'stop' as const };
      } },
      onEvent: (event: ReActStreamEvent) => {
        if (event.type === 'usage') usages.push(event.usage);
      },
    };
    const result = name === 'native'
      ? await runReActLoopNative({ ...params, toolDefs: [] })
      : await runReActLoop(params);

    assert.deepEqual(usages, [firstUsage, null]);
    assert.equal(result.usage, undefined);
  });
}

test('native reports usage before executing the tool requested by that model call', async () => {
  const events: ReActStreamEvent[] = [];
  let calls = 0;
  await runReActLoopNative({
    messages: [{ role: 'user', content: 'ping' }],
    llm: { call: async () => (++calls === 1
      ? {
          content: '', finishReason: 'tool_calls' as const, usage: firstUsage,
          toolCalls: [{ id: 'ping-1', name: 'ping', arguments: '{}' }],
        }
      : { content: 'pong', finishReason: 'stop' as const, usage: secondUsage }) },
    tools: { call: async () => {
      assert.deepEqual(events.filter(event => event.type === 'usage'), [
        { type: 'usage', usage: firstUsage },
      ]);
      return 'ok';
    } },
    toolDefs: [{ name: 'ping', description: 'ping', parameters: { type: 'object' } }],
    onEvent: event => events.push(event),
  });
  assert.deepEqual(events.filter(event => event.type === 'usage'), [
    { type: 'usage', usage: firstUsage },
    { type: 'usage', usage: secondUsage },
  ]);
});

for (const name of ['native', 'text'] as const) {
  test(`${name} clears current usage when a later model request fails`, async () => {
    const usages: Array<TokenUsage | null> = [];
    let calls = 0;
    const params = {
      messages: [{ role: 'user' as const, content: 'continue' }],
      llm: { call: async () => {
        if (++calls === 1) {
          return { content: 'first part', finishReason: 'length' as const, usage: firstUsage };
        }
        throw new Error('provider disconnected');
      } },
      onEvent: (event: ReActStreamEvent) => {
        if (event.type === 'usage') usages.push(event.usage);
      },
    };
    const result = name === 'native'
      ? await runReActLoopNative({ ...params, toolDefs: [] })
      : await runReActLoop(params);

    assert.equal(result.termination.status, 'failed');
    assert.deepEqual(usages, [firstUsage, null]);
    assert.equal(result.usage, undefined);
  });
}
