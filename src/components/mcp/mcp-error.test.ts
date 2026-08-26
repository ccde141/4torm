import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveMessage } from '../../i18n/locale.js';
import { mcpErrorMessage } from './mcp-error.js';
import { McpFormError } from './mcp-form.js';

test('MCP 校验错误按当前语言呈现并保留用户字段名', () => {
  const reason = new McpFormError('stringRequired', { field: 'MCP 用户服务.env.TOKEN' });
  const english = mcpErrorMessage(reason, (key, values) => resolveMessage('en-US', key, values));

  assert.equal(english, 'MCP 用户服务.env.TOKEN must be a string');
});

test('外部错误保持原始内容', () => {
  const external = new Error('upstream detail');
  const message = mcpErrorMessage(external, (key, values) => resolveMessage('en-US', key, values));

  assert.equal(message, 'upstream detail');
});
