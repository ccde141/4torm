import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMcpToolResult, readMcpToolOutcome } from './mcp-result.js';

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

test('MCP isError 决定执行状态，不从正文猜测', () => {
  assert.deepEqual(readMcpToolOutcome({ isError: true,
    content: [{ type: 'text', text: 'permission denied' }] }),
  { result: 'permission denied', ok: false });
  assert.deepEqual(readMcpToolOutcome({ isError: false,
    content: [{ type: 'text', text: 'Error: literal file contents' }] }),
  { result: 'Error: literal file contents', ok: true });
});

test('MCP isError 的非法类型显式报协议错误', () => {
  assert.throws(() => readMcpToolOutcome({ isError: 'true', content: [] }),
    /MCP tools\/call isError 必须是布尔值/);
});
