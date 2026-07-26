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
  }]);
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
