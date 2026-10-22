import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAnthropicRequest,
  createAnthropicStreamAccumulator,
  parseAnthropicResponse,
} from './anthropic.js';

test('Anthropic request separates system text and maps tool history', () => {
  const request = buildAnthropicRequest({
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: 'secret',
    model: 'claude-sonnet-4-5',
    stream: false,
    maxTokens: 2048,
    temperature: 0.4,
    messages: [
      { role: 'system', content: 'You are precise.' },
      { role: 'user', content: 'Inspect this.' },
      {
        role: 'assistant', content: '',
        toolCalls: [{ id: 'toolu_1', name: 'read_file', arguments: '{"path":"a.txt"}' }],
      },
      { role: 'tool', toolCallId: 'toolu_1', content: 'hello' },
    ],
    tools: [{
      name: 'read_file', description: 'Read a file',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    }],
  });

  assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(request.headers['x-api-key'], 'secret');
  assert.equal(request.headers['anthropic-version'], '2023-06-01');
  assert.equal(request.body.system, 'You are precise.');
  assert.deepEqual(request.body.tools, [{
    name: 'read_file', description: 'Read a file',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  }]);
  assert.deepEqual(request.body.messages[1], {
    role: 'assistant',
    content: [{ type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'a.txt' } }],
  });
  assert.deepEqual(request.body.messages[2], {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'hello' }],
  });
});

test('Anthropic native request restores prior text tool calls and results', () => {
  const request = buildAnthropicRequest({
    baseUrl: 'https://api.anthropic.com/v1', model: 'claude',
    stream: false, maxTokens: 1024,
    messages: [
      { role: 'user', content: 'Inspect both files.' },
      { role: 'assistant', content: '{"type":"tool_call","name":"read_file","arguments":{"path":"a.txt"}}' },
      { role: 'user', content: '{"type":"tool_result","name":"read_file","ok":true,"content":"A"}' },
      { role: 'assistant', content: '{"type":"tool_call","name":"read_file","arguments":{"path":"b.txt"}}' },
      { role: 'user', content: '{"type":"tool_result","name":"read_file","ok":true,"content":"B"}' },
    ],
    tools: [{ name: 'read_file', description: 'Read a file', parameters: {
      type: 'object', properties: { path: { type: 'string' } }, required: ['path'],
    } }],
  });

  assert.deepEqual(request.body.messages.slice(1), [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'text-history-1', name: 'read_file', input: { path: 'a.txt' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'text-history-1', content: 'A' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'text-history-3', name: 'read_file', input: { path: 'b.txt' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'text-history-3', content: 'B' }] },
  ]);
});

test('Anthropic native request preserves a failed text tool result', () => {
  const request = buildAnthropicRequest({
    baseUrl: 'https://api.anthropic.com/v1', model: 'claude',
    stream: false, maxTokens: 1024,
    messages: [
      { role: 'assistant', content: '{"type":"tool_call","name":"read_file","arguments":{}}' },
      { role: 'user', content: '{"type":"tool_result","name":"read_file","ok":false,"content":"permission denied"}' },
    ],
    tools: [{ name: 'read_file', description: '', parameters: { type: 'object', properties: {} } }],
  });

  assert.deepEqual(request.body.messages[1], {
    role: 'user', content: [{ type: 'tool_result', tool_use_id: 'text-history-0',
      content: 'permission denied', is_error: true }],
  });
});

test('Anthropic native request marks an explicit native tool failure as is_error', () => {
  const request = buildAnthropicRequest({
    baseUrl: 'https://api.anthropic.com/v1', model: 'claude',
    stream: false, maxTokens: 1024,
    messages: [
      { role: 'assistant', content: '', toolCalls: [
        { id: 'failed', name: 'inspect', arguments: '{}' },
      ] },
      { role: 'tool', toolCallId: 'failed', content: 'permission denied', toolOk: false },
    ],
    tools: [{ name: 'inspect', description: '', parameters: { type: 'object', properties: {} } }],
  });

  assert.deepEqual(request.body.messages[1], {
    role: 'user', content: [{ type: 'tool_result', tool_use_id: 'failed',
      content: 'permission denied', is_error: true }],
  });
});

test('Anthropic text request encodes prior native tool calls and results', () => {
  const request = buildAnthropicRequest({
    baseUrl: 'https://api.anthropic.com/v1', model: 'claude',
    stream: false, maxTokens: 1024,
    messages: [
      { role: 'user', content: 'Inspect the file.' },
      { role: 'assistant', content: '', toolCalls: [
        { id: 'call-1', name: 'read_file', arguments: '{"path":"a.txt"}' },
      ] },
      { role: 'tool', toolCallId: 'call-1', content: 'A' },
      { role: 'user', content: 'What next?' },
    ],
  });

  assert.equal(request.body.tools, undefined);
  assert.deepEqual(request.body.messages, [
    { role: 'user', content: [{ type: 'text', text: 'Inspect the file.' }] },
    { role: 'assistant', content: [{ type: 'text', text: '{"type":"tool_call","name":"read_file","arguments":{"path":"a.txt"}}' }] },
    { role: 'user', content: [
      { type: 'text', text: '{"type":"tool_result","name":"read_file","ok":true,"content":"A"}' },
      { type: 'text', text: 'What next?' },
    ] },
  ]);
});

test('Anthropic request respects explicit headers without losing protocol defaults', () => {
  const request = buildAnthropicRequest({
    baseUrl: 'https://proxy.example/v1/messages',
    apiKey: '',
    customHeaders: { Authorization: 'Bearer proxy', 'anthropic-version': '2024-01-01' },
    model: 'claude', stream: true, maxTokens: 1024,
    messages: [{ role: 'user', content: 'hello' }],
  });

  assert.equal(request.url, 'https://proxy.example/v1/messages');
  assert.equal(new Headers(request.headers).get('authorization'), 'Bearer proxy');
  assert.equal(request.headers['anthropic-version'], '2024-01-01');
  assert.equal(request.body.stream, true);
});

test('Anthropic request converts user images to base64 source blocks', () => {
  const request = buildAnthropicRequest({
    baseUrl: 'https://api.anthropic.com/v1', model: 'claude',
    stream: false, maxTokens: 1024,
    messages: [{
      role: 'user', content: '描述图片',
      images: [{
        id: 'image-1', name: 'screen.png', mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,AAAA',
      }],
    }],
  });

  assert.deepEqual(request.body.messages, [{
    role: 'user',
    content: [
      { type: 'text', text: '描述图片' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ],
  }]);
});

test('Anthropic response normalizes text, thinking, tools, usage and finish reason', () => {
  const result = parseAnthropicResponse({
    content: [
      { type: 'thinking', thinking: 'check', signature: 'signed-thinking' },
      { type: 'redacted_thinking', data: 'opaque-thinking' },
      { type: 'text', text: 'I will inspect it.' },
      { type: 'tool_use', id: 'toolu_2', name: 'read_file', input: { path: 'a.txt' } },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 12, output_tokens: 8 },
  }, new Map());

  assert.equal(result.content, 'I will inspect it.');
  assert.equal(result.reasoningContent, 'check');
  assert.deepEqual(result.reasoningEnvelope, {
    field: 'anthropic_thinking',
    value: [
      { type: 'thinking', thinking: 'check', signature: 'signed-thinking' },
      { type: 'redacted_thinking', data: 'opaque-thinking' },
    ],
  });
  assert.equal(result.finishReason, 'tool_calls');
  assert.deepEqual(result.toolCalls, [
    { id: 'toolu_2', name: 'read_file', arguments: '{"path":"a.txt"}' },
  ]);
  assert.deepEqual(result.usage, { promptTokens: 12, completionTokens: 8, totalTokens: 20 });
});

test('Anthropic stream accumulator keeps tool JSON fragments separate from text', () => {
  const chunks: string[] = [];
  const thoughts: string[] = [];
  const stream = createAnthropicStreamAccumulator(new Map(), chunks.push.bind(chunks), thoughts.push.bind(thoughts));
  stream.push({ type: 'message_start', message: { usage: { input_tokens: 5 } } });
  stream.push({ type: 'content_block_start', index: 0, content_block: { type: 'text' } });
  stream.push({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } });
  stream.push({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_3', name: 'write_file' } });
  stream.push({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":' } });
  stream.push({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"b.txt"}' } });
  stream.push({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 7 } });

  assert.deepEqual(chunks, ['done']);
  assert.deepEqual(stream.finish(), {
    content: 'done',
    reasoningContent: undefined,
    finishReason: 'tool_calls',
    usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 },
    toolCalls: [{ id: 'toolu_3', name: 'write_file', arguments: '{"path":"b.txt"}' }],
  });
});

test('Anthropic stream accumulator preserves signed thinking for replay', () => {
  const stream = createAnthropicStreamAccumulator(new Map(), () => {}, () => {});
  stream.push({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } });
  stream.push({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'inspect' } });
  stream.push({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signed' } });
  stream.push({ type: 'content_block_start', index: 1, content_block: { type: 'redacted_thinking', data: 'opaque' } });

  assert.deepEqual(stream.finish().reasoningEnvelope, {
    field: 'anthropic_thinking',
    value: [
      { type: 'thinking', thinking: 'inspect', signature: 'signed' },
      { type: 'redacted_thinking', data: 'opaque' },
    ],
  });
});

test('Anthropic request replays thinking blocks before assistant tools', () => {
  const request = buildAnthropicRequest({
    baseUrl: 'https://api.anthropic.com/v1', model: 'claude', stream: false, maxTokens: 1024,
    tools: [{ name: 'read_file', description: 'Read a file' }],
    messages: [{
      role: 'assistant', content: '',
      reasoningEnvelope: {
        field: 'anthropic_thinking',
        value: [{ type: 'thinking', thinking: 'inspect', signature: 'signed' }],
      },
      toolCalls: [{ id: 'toolu_4', name: 'read_file', arguments: '{}' }],
    }, { role: 'tool', toolCallId: 'toolu_4', content: 'file body' }],
  });

  assert.deepEqual(request.body.messages, [{
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'inspect', signature: 'signed' },
      { type: 'tool_use', id: 'toolu_4', name: 'read_file', input: {} },
    ],
  }, {
    role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_4', content: 'file body' }],
  }]);
});
