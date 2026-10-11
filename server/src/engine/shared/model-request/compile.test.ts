import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModelMessages } from './compile.js';

test('compiles canonical tool history for the selected target model', () => {
  const messages = compileModelMessages([
    { role: 'user', content: 'inspect the file' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call-1', name: 'read_file', arguments: '{"path":"a.txt"}' }],
    },
    { role: 'tool', toolCallId: 'call-1', content: 'file body' },
    { role: 'assistant', content: 'done' },
  ], {
    identity: { baseUrl: 'https://api.example.test/v1', model: 'target-model' },
    forwardToolNames: new Map(),
  });

  assert.deepEqual(messages, [
    { role: 'user', content: 'inspect the file' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call-1',
        type: 'function',
        function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
      }],
    },
    { role: 'tool', tool_call_id: 'call-1', content: 'file body' },
    { role: 'assistant', content: 'done' },
  ]);
});

test('does not expose foreign reasoning fields to the selected target model', () => {
  const messages = compileModelMessages([
    {
      role: 'assistant',
      content: '',
      reasoningContent: 'private reasoning',
      reasoningEnvelope: { field: 'reasoning_details', value: [{ type: 'opaque' }] },
      toolCalls: [{ id: 'call-1', name: 'read_file', arguments: '{}' }],
    },
    { role: 'tool', toolCallId: 'call-1', content: 'file body' },
  ], {
    identity: { baseUrl: 'https://api.example.test/v1', model: 'target-model' },
    forwardToolNames: new Map(),
  });

  assert.deepEqual(messages, [{
    role: 'assistant',
    content: null,
    tool_calls: [{
      id: 'call-1',
      type: 'function',
      function: { name: 'read_file', arguments: '{}' },
    }],
  }, { role: 'tool', tool_call_id: 'call-1', content: 'file body' }]);
});

test('restores strict text tool history when the target uses native tools', () => {
  const messages = compileModelMessages([
    { role: 'user', content: 'inspect the file' },
    {
      role: 'assistant',
      content: '{"type":"tool_call","name":"read_file","arguments":{"path":"a.txt"}}',
    },
    {
      role: 'user',
      content: '{"type":"tool_result","name":"read_file","ok":true,"content":"file body"}',
    },
  ], {
    identity: { baseUrl: 'https://api.example.test/v1', model: 'target-model' },
    forwardToolNames: new Map(),
    toolTransport: 'native',
  });

  assert.deepEqual(messages, [
    { role: 'user', content: 'inspect the file' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'text-history-1',
        type: 'function',
        function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
      }],
    },
    { role: 'tool', tool_call_id: 'text-history-1', content: 'file body' },
  ]);
});

test('OpenAI native request keeps a failed text tool result visibly failed', () => {
  const messages = compileModelMessages([
    { role: 'assistant', content: '{"type":"tool_call","name":"read_file","arguments":{}}' },
    { role: 'user', content: '{"type":"tool_result","name":"read_file","ok":false,"content":"permission denied"}' },
  ], {
    identity: { baseUrl: 'https://api.example.test/v1', model: 'target-model' },
    forwardToolNames: new Map([['read_file', 'read_file']]),
    toolTransport: 'native',
  });

  assert.deepEqual(messages[1], {
    role: 'tool', tool_call_id: 'text-history-0', content: 'Error: permission denied',
  });
});

test('OpenAI native request keeps an explicit native failure visibly failed', () => {
  const messages = compileModelMessages([
    { role: 'assistant', content: '', toolCalls: [
      { id: 'failed', name: 'mcp:test:inspect', arguments: '{}' },
    ] },
    { role: 'tool', toolCallId: 'failed', content: 'permission denied', toolOk: false },
  ], {
    identity: { baseUrl: 'https://api.example.test/v1', model: 'target-model' },
    forwardToolNames: new Map([['mcp:test:inspect', 'mcp_test_inspect']]),
    toolTransport: 'native',
  });

  assert.deepEqual(messages[1], {
    role: 'tool', tool_call_id: 'failed', content: 'Error: permission denied',
  });
});

test('native target leaves an unclosed text tool call unconverted', () => {
  const call = '{"type":"tool_call","name":"read_file","arguments":{"path":"a.txt"}}';
  const messages = compileModelMessages([
    { role: 'assistant', content: call },
    { role: 'user', content: 'The call was interrupted; continue.' },
  ], {
    identity: { baseUrl: 'https://api.example.test/v1', model: 'target-model' },
    forwardToolNames: new Map([['read_file', 'read_file']]),
    toolTransport: 'native',
  });

  assert.deepEqual(messages, [
    { role: 'assistant', content: call },
    { role: 'user', content: 'The call was interrupted; continue.' },
  ]);
});

test('native target preserves an incomplete native call group as text history', () => {
  const messages = compileModelMessages([
    { role: 'assistant', content: '', toolCalls: [
      { id: 'first', name: 'read_file', arguments: '{"path":"a.txt"}' },
      { id: 'missing', name: 'write_file', arguments: '{"path":"b.txt"}' },
    ] },
    { role: 'tool', toolCallId: 'first', content: 'A' },
    { role: 'user', content: 'Continue after interruption.' },
  ], {
    identity: { baseUrl: 'https://api.example.test/v1', model: 'target-model' },
    forwardToolNames: new Map([['read_file', 'read_file'], ['write_file', 'write_file']]),
    toolTransport: 'native',
  });

  assert.equal(messages[0].role, 'assistant');
  assert.equal(messages[0].tool_calls, undefined);
  assert.match(String(messages[0].content), /"name":"read_file"/);
  assert.match(String(messages[0].content), /"name":"write_file"/);
  assert.deepEqual(messages.slice(1), [
    { role: 'user', content: '{"type":"tool_result","name":"read_file","ok":true,"content":"A"}' },
    { role: 'user', content: 'Continue after interruption.' },
  ]);
});

test('native target sanitizes historical MCP names after tools change', () => {
  const messages = compileModelMessages([
    { role: 'assistant', content: '', toolCalls: [
      { id: 'old-1', name: 'mcp:old:read', arguments: '{}' },
      { id: 'old-2', name: 'mcp_old_read', arguments: '{}' },
    ] },
    { role: 'tool', toolCallId: 'old-1', content: 'A' },
    { role: 'tool', toolCallId: 'old-2', content: 'B' },
    { role: 'assistant', content: '{"type":"tool_call","name":"mcp:legacy:lookup","arguments":{}}' },
    { role: 'user', content: '{"type":"tool_result","name":"mcp:legacy:lookup","ok":true,"content":"C"}' },
  ], {
    identity: { baseUrl: 'https://api.example.test/v1', model: 'target-model' },
    forwardToolNames: new Map([['read_file', 'read_file'], ['mcp:current', 'mcp_old_read']]),
    toolTransport: 'native',
  });

  assert.deepEqual(messages.map(message => message.role), [
    'assistant', 'tool', 'tool', 'assistant', 'tool',
  ]);
  const firstCalls = messages[0].tool_calls as Array<{ function: { name: string } }>;
  const secondCalls = messages[3].tool_calls as Array<{ function: { name: string } }>;
  assert.deepEqual(firstCalls.map(call => call.function.name), ['mcp_old_read_1', 'mcp_old_read_2']);
  assert.equal(secondCalls[0].function.name, 'mcp_legacy_lookup');
  assert.equal(messages[1].tool_call_id, 'old-1');
  assert.equal(messages[2].tool_call_id, 'old-2');
  assert.equal(messages[4].tool_call_id, 'text-history-3');
});

test('encodes canonical native tool history when the target uses text tools', () => {
  const messages = compileModelMessages([
    { role: 'user', content: 'inspect the file' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call-1', name: 'read_file', arguments: '{"path":"a.txt"}' }],
    },
    { role: 'tool', toolCallId: 'call-1', content: 'file body' },
  ], {
    identity: { baseUrl: 'https://api.example.test/v1', model: 'target-model' },
    forwardToolNames: new Map(),
    toolTransport: 'text',
  });

  assert.deepEqual(messages, [
    { role: 'user', content: 'inspect the file' },
    {
      role: 'assistant',
      content: '{"type":"tool_call","name":"read_file","arguments":{"path":"a.txt"}}',
    },
    {
      role: 'user',
      content: '{"type":"tool_result","name":"read_file","ok":true,"content":"file body"}',
    },
  ]);
});

test('text target preserves explicit native tool status over content wording', () => {
  const messages = compileModelMessages([
    { role: 'assistant', content: '', toolCalls: [
      { id: 'failed', name: 'inspect', arguments: '{}' },
      { id: 'succeeded', name: 'read_file', arguments: '{}' },
    ] },
    { role: 'tool', toolCallId: 'failed', content: 'permission denied', toolOk: false },
    { role: 'tool', toolCallId: 'succeeded', content: 'Error: appears in source file', toolOk: true },
  ], {
    identity: { baseUrl: 'https://api.example.test/v1', model: 'target-model' },
    forwardToolNames: new Map(), toolTransport: 'text',
  });

  assert.deepEqual(messages.slice(1).map(message => JSON.parse(String(message.content)).ok), [
    false, true,
  ]);
});

test('text target pairs results by turn when native call IDs are reused', () => {
  const messages = compileModelMessages([
    { role: 'assistant', content: '', toolCalls: [
      { id: 'call_1', name: 'read_file', arguments: '{"path":"a.txt"}' },
    ] },
    { role: 'tool', toolCallId: 'call_1', content: 'A' },
    { role: 'assistant', content: '', toolCalls: [
      { id: 'call_1', name: 'write_file', arguments: '{"path":"b.txt"}' },
    ] },
    { role: 'tool', toolCallId: 'call_1', content: 'B' },
  ], {
    identity: { baseUrl: 'https://api.example.test/v1', model: 'target-model' },
    forwardToolNames: new Map(),
    toolTransport: 'text',
  });

  assert.deepEqual(messages.filter(message => message.role === 'user').map(message => message.content), [
    '{"type":"tool_result","name":"read_file","ok":true,"content":"A"}',
    '{"type":"tool_result","name":"write_file","ok":true,"content":"B"}',
  ]);
});

test('text target does not invent empty arguments for malformed native history', () => {
  const messages = compileModelMessages([
    { role: 'assistant', content: '', toolCalls: [
      { id: 'broken', name: 'write_file', arguments: '{"path":' },
    ] },
    { role: 'tool', toolCallId: 'broken', content: '参数 JSON 解析失败' },
  ], {
    identity: { baseUrl: 'https://api.example.test/v1', model: 'target-model' },
    forwardToolNames: new Map(),
    toolTransport: 'text',
  });

  assert.equal(messages[0].content,
    '{"type":"invalid_tool_call","name":"write_file","raw_arguments":"{\\"path\\":"}');
  assert.match(String(messages[1].content), /参数 JSON 解析失败/);
});

test('folds every system message into one leading provider message', () => {
  const messages = compileModelMessages([
    { role: 'system', content: 'Agent role' },
    { role: 'user', content: 'Earlier request' },
    { role: 'assistant', content: 'Earlier answer' },
    { role: 'system', content: '[历史上下文摘要]\nSummary' },
    { role: 'user', content: 'Continue' },
  ], {
    identity: { baseUrl: 'https://api.example.test/v1', model: 'qwen' },
    forwardToolNames: new Map(),
  });

  assert.deepEqual(messages, [
    { role: 'system', content: 'Agent role\n\n[历史上下文摘要]\nSummary' },
    { role: 'user', content: 'Earlier request' },
    { role: 'assistant', content: 'Earlier answer' },
    { role: 'user', content: 'Continue' },
  ]);
});
