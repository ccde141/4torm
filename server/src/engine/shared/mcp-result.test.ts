import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMcpToolResult, readMcpToolOutcome } from './mcp-result.js';

test('MCP 文本结果按顺序合并', () => {
  assert.equal(formatMcpToolResult({ content: [
    { type: 'text', text: 'first' },
    { type: 'text', text: 'second' },
  ] }), 'first\nsecond');
});

test('MCP 图片保留在临时类型字段，兼容正文不包含base64', () => {
  const input = { content: [
    { type: 'image', mimeType: 'image/png', data: 'base64-data' },
  ] };
  const result = formatMcpToolResult(input);

  assert.match(result, /image\/png/);
  assert.doesNotMatch(result, /base64-data/);
  assert.deepEqual(readMcpToolOutcome(input).inlineImages, [{ mimeType: 'image/png', data: 'base64-data' }]);
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

test('文本与结构化内容同时保留，只有结构化内容也不返回空结果或重复JSON', () => {
  const structuredContent = { fact: '真实数据', count: 2 };
  const json = JSON.stringify(structuredContent);
  assert.deepEqual(readMcpToolOutcome({ content: [], structuredContent }), { result: json, ok: true, structuredContent });
  assert.equal(readMcpToolOutcome({ structuredContent }).result, json);
  assert.equal(readMcpToolOutcome({ content: [{ type: 'text', text: '概要' }], structuredContent }).result, `概要\n${json}`);
  assert.equal(readMcpToolOutcome({ content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }], structuredContent }).result,
    JSON.stringify(structuredContent, null, 2));
});

test('音频和二进制资源不会被JSON序列化成正文，资源链接不自动获取', () => {
  const outcome = readMcpToolOutcome({ content: [
    { type: 'audio', mimeType: 'audio/wav', data: 'AUDIO_BYTES' },
    { type: 'resource', resource: { uri: 'resource://fixture', mimeType: 'application/octet-stream', blob: 'RESOURCE_BYTES' } },
    { type: 'resource', resource: { uri: 'resource://text', text: '可读资源正文' } },
    { type: 'resource_link', uri: 'https://example.invalid/image', name: 'remote' },
    { type: 'unknown', nested: { mimeType: 'image/png', data: 'NESTED_BYTES' } },
  ], structuredContent: { embedded: { blob: 'STRUCTURED_BYTES' } } });
  assert.doesNotMatch(outcome.result, /AUDIO_BYTES|RESOURCE_BYTES|NESTED_BYTES|STRUCTURED_BYTES/);
  assert.match(outcome.result, /可读资源正文/);
  assert.match(outcome.result, /未自动读取/);
  assert.match(outcome.result, /不支持.*音频|音频.*不支持/);
});

test('单次MCP结果最多收集4张图片，多余图片有明确说明', () => {
  const outcome = readMcpToolOutcome({ content: Array.from({ length: 5 }, () => ({ type: 'image', mimeType: 'image/png', data: 'fixture' })) });
  assert.equal(outcome.inlineImages?.length, 4);
  assert.match(outcome.result, /4 张上限/);
});
