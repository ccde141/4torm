import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAnthropicRequest } from './anthropic.js';

test('Anthropic tool mapping preserves the complete root input schema', () => {
  const parameters = {
    type: 'object',
    properties: { feature: { type: 'string', enum: ['cyclone', 'tide'] } },
    required: ['feature'],
    additionalProperties: false,
    minProperties: 1,
  };
  const request = buildAnthropicRequest({
    baseUrl: 'https://api.anthropic.com/v1', model: 'claude',
    stream: false, maxTokens: 1024,
    messages: [{ role: 'user', content: 'Inspect an operation.' }],
    tools: [{ name: 'inspect_operation', description: 'Inspect operation', parameters }],
  });

  assert.deepEqual(request.body.tools[0].input_schema, parameters);
});
