import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatTextToolCall,
  formatTextToolResult,
  parseTextToolResult,
  parseTextToolResponse,
} from './text-tool-protocol.js';

test('parses a bare JSON tool-call envelope', () => {
  assert.deepEqual(parseTextToolResponse(JSON.stringify({
    type: 'tool_call',
    name: 'read_file',
    arguments: { filePath: 'README.md' },
  })), {
    kind: 'tool-call',
    name: 'read_file',
    arguments: { filePath: 'README.md' },
  });
});

test('parses an exact tool_call fenced envelope', () => {
  const response = '```tool_call\n{"type":"tool_call","name":"ping","arguments":{}}\n```';
  assert.equal(parseTextToolResponse(response).kind, 'tool-call');
});

test('parses an exact json fenced tool-call envelope from the prompt example', () => {
  const response = '```json\n{"type":"tool_call","name":"ping","arguments":{}}\n```';
  assert.deepEqual(parseTextToolResponse(response), {
    kind: 'tool-call', name: 'ping', arguments: {},
  });
});

test('reports malformed exact json fenced tool calls without executing prose examples', () => {
  const malformed = '```json\n{"type":"tool_call","name":"ping","arguments":\n```';
  assert.equal(parseTextToolResponse(malformed).kind, 'invalid');
  const example = `Example:\n${malformed}`;
  assert.deepEqual(parseTextToolResponse(example), { kind: 'final', content: example });
});

test('keeps an exact fenced ordinary JSON answer as final content', () => {
  const answer = '```json\n{"status":"ok"}\n```';
  assert.deepEqual(parseTextToolResponse(answer), { kind: 'final', content: answer });
});

test('treats ordinary prose and quoted JSON as a final answer', () => {
  const response = 'Example:\n```json\n{"type":"tool_call","name":"ping","arguments":{}}\n```';
  assert.deepEqual(parseTextToolResponse(response), { kind: 'final', content: response });
});

test('rejects a malformed envelope instead of treating it as an answer', () => {
  const parsed = parseTextToolResponse('{"type":"tool_call","name":"ping","arguments":');
  assert.equal(parsed.kind, 'invalid');
});

test('rejects non-object arguments', () => {
  const parsed = parseTextToolResponse(
    '{"type":"tool_call","name":"ping","arguments":"wrong"}',
  );
  assert.deepEqual(parsed, {
    kind: 'invalid',
    error: 'Tool-call arguments must be a JSON object.',
  });
});

test('rejects text surrounding a tool-call envelope', () => {
  const response = 'I will call it.\n{"type":"tool_call","name":"ping","arguments":{}}';
  assert.deepEqual(parseTextToolResponse(response), { kind: 'final', content: response });
});

test('formats tool results as a framework-owned JSON envelope', () => {
  assert.equal(formatTextToolResult('ping', 'pong', true), JSON.stringify({
    type: 'tool_result',
    name: 'ping',
    ok: true,
    content: 'pong',
  }));
});

test('formats and parses strict tool envelopes for request compilation', () => {
  const call = formatTextToolCall('ping', { value: 1 });
  assert.deepEqual(parseTextToolResponse(call), {
    kind: 'tool-call', name: 'ping', arguments: { value: 1 },
  });
  assert.deepEqual(parseTextToolResult(formatTextToolResult('ping', 'pong', true)), {
    name: 'ping', content: 'pong', ok: true,
  });
});
