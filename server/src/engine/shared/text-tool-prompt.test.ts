import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTextToolProtocol } from './prompt.js';

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
  assert.match(prompt, /"name":"read_file"/);
  assert.match(prompt, /"arguments":\{\}/);
  assert.match(prompt, /filePath: string \[必填\]/);
  assert.match(prompt, /普通自然语言/);
  assert.doesNotMatch(prompt, /<action|<answer|<think|<result/);
});
