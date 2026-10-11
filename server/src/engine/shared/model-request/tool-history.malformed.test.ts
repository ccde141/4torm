import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModelMessages } from './compile.js';
import { buildAnthropicRequest } from '../provider-transports/anthropic.js';
import type { ContextMessage } from '../types.js';

const malformedHistory: ContextMessage[] = [
  { role: 'assistant', content: '', toolCalls: [
    { id: 'bad-call', name: 'read_file', arguments: '{"path":' },
  ] },
  { role: 'tool', toolCallId: 'bad-call', content: '参数 JSON 解析失败', toolOk: false },
];

test('OpenAI native replay downgrades a paired call with malformed arguments', () => {
  const messages = compileModelMessages(malformedHistory, {
    identity: { baseUrl: 'https://api.example.test/v1', model: 'target-model' },
    forwardToolNames: new Map([['read_file', 'read_file']]),
    toolTransport: 'native',
  });

  assert.equal(messages[0].tool_calls, undefined);
  assert.deepEqual(JSON.parse(String(messages[0].content)), {
    type: 'invalid_tool_call', name: 'read_file', raw_arguments: '{"path":',
  });
  assert.deepEqual(JSON.parse(String(messages[1].content)), {
    type: 'tool_result', name: 'read_file', ok: false, content: '参数 JSON 解析失败',
  });
});

test('Anthropic native replay downgrades a paired call with malformed arguments', () => {
  const request = buildAnthropicRequest({
    baseUrl: 'https://api.anthropic.com/v1', model: 'target-model',
    stream: false, maxTokens: 1024, messages: malformedHistory,
    tools: [{ name: 'read_file', description: '', parameters: { type: 'object', properties: {} } }],
  });

  assert.deepEqual(request.body.messages.map((message: { role: string }) => message.role), [
    'assistant', 'user',
  ]);
  assert.equal(request.body.messages[0].content[0].type, 'text');
  assert.deepEqual(JSON.parse(request.body.messages[0].content[0].text), {
    type: 'invalid_tool_call', name: 'read_file', raw_arguments: '{"path":',
  });
  assert.equal(request.body.messages[1].content[0].type, 'text');
  assert.deepEqual(JSON.parse(request.body.messages[1].content[0].text), {
    type: 'tool_result', name: 'read_file', ok: false, content: '参数 JSON 解析失败',
  });
});

test('Anthropic native request keeps current and historical tool names distinct', () => {
  const request = buildAnthropicRequest({
    baseUrl: 'https://api.anthropic.com/v1', model: 'claude',
    stream: false, maxTokens: 1024,
    messages: [{ role: 'assistant', content: '', toolCalls: [
      { id: 'old-1', name: 'mcp:old:read', arguments: '{}' },
      { id: 'old-2', name: 'mcp_old_read', arguments: '{}' },
    ] },
    { role: 'tool', toolCallId: 'old-1', content: 'A' },
    { role: 'tool', toolCallId: 'old-2', content: 'B' }],
    tools: [
      { name: 'mcp:current:read', description: '', parameters: { type: 'object', properties: {} } },
      { name: 'mcp_current_read', description: '', parameters: { type: 'object', properties: {} } },
    ],
  });

  assert.deepEqual(request.body.tools.map((tool: { name: string }) => tool.name), [
    'mcp_current_read_1', 'mcp_current_read',
  ]);
  assert.deepEqual(request.body.messages[0].content.map((block: { name: string }) => block.name), [
    'mcp_old_read', 'mcp_old_read_1',
  ]);
  assert.equal(request.body.messages[1].content[0].tool_use_id, 'old-1');
  assert.equal(request.body.messages[1].content[1].tool_use_id, 'old-2');
});

test('Anthropic native request does not send an unpaired historical tool_use', () => {
  const request = buildAnthropicRequest({
    baseUrl: 'https://api.anthropic.com/v1', model: 'claude',
    stream: false, maxTokens: 1024,
    messages: [
      { role: 'assistant', content: '', toolCalls: [
        { id: 'pending', name: 'read_file', arguments: '{}' },
      ] },
      { role: 'user', content: 'The tool did not run.' },
    ],
    tools: [{ name: 'read_file', description: '', parameters: { type: 'object', properties: {} } }],
  });

  assert.deepEqual(request.body.messages, [
    { role: 'assistant', content: [{ type: 'text', text: '{"type":"tool_call","name":"read_file","arguments":{}}' }] },
    { role: 'user', content: [{ type: 'text', text: 'The tool did not run.' }] },
  ]);
});
