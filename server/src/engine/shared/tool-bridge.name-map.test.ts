import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreToolName, toProviderToolsWithMap } from './tool-bridge.js';
import type { ToolDef } from './tool-defs-loader.js';

test('provider tool names remain unique when a sanitized name matches a legal name', () => {
  const definitions: ToolDef[] = [
    { name: 'mcp:foo', description: 'MCP tool' },
    { name: 'mcp_foo', description: 'Local tool' },
    { name: 'mcp.foo', description: 'Another MCP tool' },
  ];
  const { tools, nameMap } = toProviderToolsWithMap(definitions, 'openai');
  const names = tools.map(tool => (tool as { function: { name: string } }).function.name);

  assert.equal(new Set(names).size, definitions.length);
  assert.equal(names[1], 'mcp_foo');
  assert.deepEqual(names.map(name => restoreToolName(name, nameMap)),
    definitions.map(definition => definition.name));
});

test('OpenAI tool mapping preserves the complete root parameter schema', () => {
  const parameters = {
    type: 'object',
    properties: { feature: { type: 'string', enum: ['cyclone', 'tide'] } },
    required: ['feature'],
    additionalProperties: false,
    minProperties: 1,
  };
  const { tools } = toProviderToolsWithMap([
    { name: 'inspect_operation', description: 'Inspect operation', parameters },
  ], 'openai');

  assert.deepEqual((tools[0] as { function: { parameters: unknown } }).function.parameters,
    parameters);
});
