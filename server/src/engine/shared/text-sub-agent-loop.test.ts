import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTextToolResult } from './text-tool-protocol.js';
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

test('text SubAgent preserves a typed MCP failure and emits one result event', async () => {
  const messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }> = [];
  const results: Array<{ result: string; ok: boolean }> = [];
  const replies = [
    '{"type":"tool_call","name":"mcp:test:inspect","arguments":{}}',
    '{"type":"tool_call","name":"done","arguments":{"summary":"reported failure"}}',
  ];
  await runTextSubAgentLoop({
    messages, maxRounds: 2, signal: new AbortController().signal,
    callModel: async () => ({ content: replies.shift() ?? '', finishReason: 'stop' }),
    callTool: async () => ({ result: 'permission denied', ok: false }),
    onToolResult: (_name, result, ok) => results.push({ result, ok }),
  });

  assert.deepEqual(results, [{ result: 'permission denied', ok: false }]);
  assert.deepEqual(parseTextToolResult(messages[1]?.content ?? ''), {
    name: 'mcp:test:inspect', content: 'permission denied', ok: false,
  });
});
