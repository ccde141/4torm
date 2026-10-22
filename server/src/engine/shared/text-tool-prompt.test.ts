import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTextToolProtocol } from './prompt.js';
import { parseTextToolResponse } from './text-tool-protocol.js';

test('text tool prompt teaches one strict JSON tool-call envelope', () => {
  const prompt = buildTextToolProtocol([{
    name: 'read_file',
    description: 'Read a file',
    parameters: {
      type: 'object',
      properties: { filePath: { type: 'string', description: 'File path' } },
      required: ['filePath'],
    },
  }]);

  assert.match(prompt, /"type":"tool_call"/);
  assert.match(prompt, /### read_file/);
  assert.match(prompt, /"arguments":\{\}/);
  assert.match(prompt, /filePath: string \[必填\]/);
  assert.doesNotMatch(prompt, /参数 JSON Schema/);
  assert.match(prompt, /普通自然语言/);
  assert.doesNotMatch(prompt, /<action|<answer|<think|<result/);
  assert.doesNotMatch(prompt, /"name":"read_file","arguments":\{\}/);
  const example = prompt.match(/```json\n([\s\S]*?)\n```/)?.[1];
  assert.equal(parseTextToolResponse(example ?? '').kind, 'tool-call');
  assert.match(prompt, /实际参数按所选工具的定义填写/);
});

test('text tool prompt retains nested schema requirements without long descriptions dominating context', () => {
  const prompt = buildTextToolProtocol([{
    name: 'framework_capability_demo', description: 'Demo',
    parameters: {
      type: 'object', required: ['action', 'input'], properties: {
        action: { type: 'string', enum: ['start'] },
        input: { type: 'object', required: ['workflowId'], properties: {
          workflowId: { type: 'string', description: 'x'.repeat(20_000) },
          mode: { type: 'string', enum: ['sync', 'async'] },
        } },
      },
    },
  }]);
  assert.match(prompt, /"required":\["workflowId"\]/);
  assert.match(prompt, /"enum":\["sync","async"\]/);
  assert.match(prompt, /"workflowId":\{"type":"string"/);
  assert.ok(prompt.length < 8_000, `prompt unexpectedly grew to ${prompt.length} characters`);
});

test('text tool prompt keeps every field when a schema exceeds the former fixed limit', () => {
  const properties = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [
    `field_${index}`, { type: 'string' },
  ]));
  const prompt = buildTextToolProtocol([{
    name: 'oversized', description: 'Too many fields',
    parameters: { type: 'object', properties, required: Object.keys(properties) },
  }]);
  assert.match(prompt, /field_499: string \[必填\]/);
  assert.ok(prompt.length > 8_000);
});

test('text tool prompt does not disable a large tool catalog', () => {
  const tools = Array.from({ length: 140 }, (_, index) => ({
    name: `tool_${index}`, description: 'x'.repeat(500),
    parameters: { type: 'object', properties: { value: { type: 'string' } } },
  }));
  const prompt = buildTextToolProtocol(tools);
  assert.match(prompt, /### tool_139/);
  assert.ok(prompt.length > 64_000);
});

test('text tool prompt tolerates a non-string property description from an external schema', () => {
  const prompt = buildTextToolProtocol([{
    name: 'external', description: 'External tool',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 42 } } },
  }]);
  assert.match(prompt, /"path":\{"type":"string"/);
  assert.match(prompt, /"description":42/);
});
