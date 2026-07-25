import assert from 'node:assert/strict';
import test from 'node:test';
import { runTextSubAgentLoop } from './text-sub-agent-loop.js';

test('text SubAgent executes tools and only succeeds through done', async () => {
  const replies = [
    '{"type":"tool_call","name":"read_file","arguments":{"filePath":"a.txt"}}',
    '{"type":"tool_call","name":"done","arguments":{"summary":"found A"}}',
  ];
  const result = await runTextSubAgentLoop({
    messages: [], maxRounds: 2, signal: new AbortController().signal,
    callModel: async () => ({ content: replies.shift() ?? '', finishReason: 'stop' }),
    callTool: async () => 'A',
  });
  assert.deepEqual(result, { status: 'success', summary: 'found A', rounds: 1 });
});

test('text SubAgent rejects natural-language completion', async () => {
  const result = await runTextSubAgentLoop({
    messages: [], maxRounds: 2, signal: new AbortController().signal,
    callModel: async () => ({ content: 'I am finished', finishReason: 'stop' }),
    callTool: async () => 'unused',
  });
  assert.equal(result.status, 'error');
  assert.match(result.error ?? '', /done/);
});

test('text SubAgent rejects recursive delegation', async () => {
  const result = await runTextSubAgentLoop({
    messages: [], maxRounds: 2, signal: new AbortController().signal,
    callModel: async () => ({
      content: '{"type":"tool_call","name":"delegate","arguments":{"task":"x"}}',
      finishReason: 'stop',
    }),
    callTool: async () => 'unused',
  });
  assert.equal(result.status, 'error');
  assert.match(result.error ?? '', /delegate/);
});
