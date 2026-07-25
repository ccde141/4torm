import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatTextToolResult,
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
