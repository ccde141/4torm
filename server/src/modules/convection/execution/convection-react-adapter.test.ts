import assert from 'node:assert/strict';
import test from 'node:test';
import { runConvectionReActWith } from './convection-react-adapter.js';
import { parseTextToolResult } from '../../../engine/shared/text-tool-protocol.js';
import type { ContextMessage } from '../../../engine/shared/types.js';

test('convection text loop uses JSON tool calls and returns natural-language content', async () => {
  const responses = [
    { content: '{"type":"tool_call","name":"read_file","arguments":{"filePath":"a.txt"}}', finishReason: 'stop' as const },
    { content: 'My public conclusion.', finishReason: 'stop' as const },
  ];
  const events: string[] = [];
  const result = await runConvectionReActWith({
    dataDir: 'data', model: 'demo:model', temperature: 0, agentId: 'a',
    sessionId: 's', label: 'Agent A', messages: [{ role: 'user', content: 'Discuss.' }],
    onEvent: event => events.push(event.type),
  }, {
    callModel: async () => responses.shift()!,
    callAgentTool: async () => 'file content',
  });

  assert.equal(result.cleanContent, 'My public conclusion.');
  assert.deepEqual(events.filter(type => type.startsWith('tool-')), ['tool-call', 'tool-result']);
});

test('convection text adapter preserves configured temperature and reasoning stream', async () => {
  let receivedTemperature: number | undefined;
  const events: Array<{ type: string; chunk?: string }> = [];

  await runConvectionReActWith({
    dataDir: 'data', model: 'demo:model', temperature: 0.35, agentId: 'a',
    sessionId: 's', label: 'Agent A', messages: [{ role: 'user', content: 'Discuss.' }],
    onEvent: event => events.push(event),
  }, {
    callModel: async (_messages, options, onChunk, _signal, onReasoning) => {
      receivedTemperature = options?.temperature;
      onReasoning?.('分析');
      onChunk?.('结论');
      return { content: '结论', finishReason: 'stop' };
    },
    callAgentTool: async () => 'unused',
  });

  assert.equal(receivedTemperature, 0.35);
  assert.deepEqual(events.filter(event => event.type === 'reasoning'), [
    { type: 'reasoning', label: 'Agent A', chunk: '分析' },
  ]);
});

test('convection adapter keeps the shared ReAct terminal state', async () => {
  const result = await runConvectionReActWith({
    dataDir: 'data', model: 'demo:model', temperature: 0, agentId: 'a',
    sessionId: 's', label: 'Agent A', messages: [{ role: 'user', content: 'Discuss.' }],
  }, {
    callModel: async () => { throw new Error('secret provider body'); },
    callAgentTool: async () => 'unused',
  });

  assert.equal(result.termination.status, 'failed');
  if (result.termination.status === 'failed') {
    assert.equal(result.termination.error.code, 'MODEL_REQUEST_FAILED');
  }
});

test('convection text loop sends failed tool status to the model and stream once', async () => {
  const events: Array<{ type: string; ok?: boolean }> = [];
  let secondMessages: ContextMessage[] = [];
  let calls = 0;
  await runConvectionReActWith({
    dataDir: 'data', model: 'demo:model', temperature: 0, agentId: 'a',
    sessionId: 's', label: 'Agent A', messages: [{ role: 'user', content: 'Discuss.' }],
    onEvent: event => events.push(event),
  }, {
    callModel: async messages => {
      if (++calls === 1) return {
        content: '{"type":"tool_call","name":"mcp:demo:search","arguments":{}}',
        finishReason: 'stop',
      };
      secondMessages = [...messages];
      return { content: 'Done.', finishReason: 'stop' };
    },
    callAgentTool: async () => ({ result: 'disabled tool', ok: false }),
  });

  assert.deepEqual(events.filter(event => event.type === 'tool-result').map(event => event.ok), [false]);
  assert.deepEqual(parseTextToolResult(secondMessages.at(-1)?.content ?? ''), {
    name: 'mcp:demo:search', content: 'disabled tool', ok: false,
  });
});

test('each model response persists reported or unknown usage before the next tool step', async () => {
  const observed: Array<number | null> = [];
  const responses = [
    { content: '{"type":"tool_call","name":"read_file","arguments":{}}',
      finishReason: 'stop' as const,
      usage: { promptTokens: 500, completionTokens: 10, totalTokens: 510 } },
    { content: 'Done.', finishReason: 'stop' as const, usage: undefined },
  ];
  await runConvectionReActWith({
    dataDir: 'data', model: 'demo:model', temperature: 0, agentId: 'a',
    sessionId: 's', label: 'Agent A', messages: [{ role: 'user', content: 'Discuss.' }],
    onUsage: async usage => { observed.push(usage?.promptTokens ?? null); },
  }, {
    callModel: async () => responses.shift()!,
    callAgentTool: async () => {
      assert.deepEqual(observed, [500]);
      return 'file content';
    },
  });
  assert.deepEqual(observed, [500, null]);
});

test('failed model request persists unknown usage before failure event', async () => {
  const observed: string[] = [];
  await runConvectionReActWith({
    dataDir: 'data', model: 'demo:model', temperature: 0, agentId: 'a',
    sessionId: 's', label: 'Agent A', messages: [{ role: 'user', content: 'Discuss.' }],
    onUsage: async usage => { observed.push(usage ? 'known' : 'unknown'); },
    onEvent: event => { if (event.type === 'usage') observed.push('event'); },
  }, {
    callModel: async () => { throw new Error('provider failed'); },
    callAgentTool: async () => 'unused',
  });
  assert.deepEqual(observed, ['unknown', 'event']);
});
