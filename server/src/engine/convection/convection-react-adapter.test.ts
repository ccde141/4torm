import assert from 'node:assert/strict';
import test from 'node:test';
import { runConvectionReActWith } from './convection-react-adapter.js';

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
