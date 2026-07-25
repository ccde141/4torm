import assert from 'node:assert/strict';
import test from 'node:test';
import { runConvectionReActWith } from './react-loop.js';

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
