import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMcpToolResult } from './mcp-result.js';

test('MCP 文本结果按顺序合并', () => {
  assert.equal(formatMcpToolResult({ content: [
    { type: 'text', text: 'first' },
    { type: 'text', text: 'second' },
  ] }), 'first\nsecond');
});

test('MCP 非文本结果不会被静默丢弃', () => {
  const result = formatMcpToolResult({ content: [
    { type: 'image', mimeType: 'image/png', data: 'base64-data' },
  ] });

  assert.match(result, /image\/png/);
  assert.match(result, /暂不支持/);
  assert.doesNotMatch(result, /base64-data/);
});
