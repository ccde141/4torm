import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConvectionToolSections } from './handlers.js';

test('对流有工具参与者在原生和文本协议前统一注入框架导航', () => {
  const tools = [{ name: 'read_file', description: '读取文件' }];
  for (const native of [false, true]) {
    const prompt = buildConvectionToolSections(tools, native).join('\n\n');
    assert.equal(prompt.match(/## 4torm 框架导航/g)?.length, 1);
  }
});

test('对流零工具角色不获得框架导航', () => {
  assert.deepEqual(buildConvectionToolSections([], true), []);
});
