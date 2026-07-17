import assert from 'node:assert/strict';
import test from 'node:test';
import { getEffectiveLocalTools } from './agent-tool-selection.js';

const tools = [
  { name: 'read_file', executorType: 'builtin' },
  { name: 'custom_tool', executorType: 'custom' },
];

test('未配置工具时只预览框架内置工具', () => {
  assert.deepEqual(
    getEffectiveLocalTools(tools, new Set()).map(tool => tool.name),
    ['read_file'],
  );
});

test('显式配置后只预览选中的本地工具', () => {
  assert.deepEqual(
    getEffectiveLocalTools(tools, new Set(['custom_tool'])).map(tool => tool.name),
    ['custom_tool'],
  );
});

test('仅选择 MCP 工具时不预览本地工具', () => {
  assert.deepEqual(getEffectiveLocalTools(tools, new Set(['mcp:demo:search'])), []);
});
