import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getDefaultSkillSelection,
  getEffectiveLocalTools,
  getInitialToolSelection,
} from './agent-tool-selection.js';

const tools = [
  { name: 'read_file', executorType: 'builtin' },
  { name: 'custom_tool', executorType: 'custom' },
];

test('新建 Agent 时显式选中全部框架内置工具', () => {
  assert.deepEqual(
    [...getInitialToolSelection(tools, [], undefined, true)],
    ['read_file'],
  );
});

test('旧 Agent 的空配置继续展开为全部框架内置工具', () => {
  assert.deepEqual(
    [...getInitialToolSelection(tools, [], undefined, false)],
    ['read_file'],
  );
});

test('显式清空工具后不再预览本地工具', () => {
  assert.deepEqual(
    getEffectiveLocalTools(tools, new Set()).map(tool => tool.name),
    [],
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

test('新建 Agent 默认启用全部已安装技能', () => {
  assert.deepEqual(
    [...getDefaultSkillSelection([{ id: 'code' }, { id: 'docs' }], [], true)],
    ['code', 'docs'],
  );
});

test('编辑 Agent 时保留已明确保存的技能选择', () => {
  assert.deepEqual(
    [...getDefaultSkillSelection([{ id: 'code' }, { id: 'docs' }], ['docs'], false)],
    ['docs'],
  );
});
