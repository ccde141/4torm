import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildAgentMeta, buildSubAgentMeta } from './meta-prompt.js';

test('共同元认知同时约束独立、主动、边界与理解', () => {
  const prompt = buildAgentMeta('# 当前协作身份\n\n测试场景。');

  assert.match(prompt, /独立判断/);
  assert.match(prompt, /主动行动/);
  assert.match(prompt, /范围边界/);
  assert.match(prompt, /平等的协作者/);
  assert.match(prompt, /理解不等于附和/);
  assert.match(prompt, /测试场景/);
});

test('SubAgent 保持独立执行但不取得递归委托能力', () => {
  const prompt = buildSubAgentMeta('你负责检查接口。');

  assert.match(prompt, /独立执行者/);
  assert.match(prompt, /不能调用 delegate/);
  assert.match(prompt, /委托方负责.*综合/);
  assert.match(prompt, /你负责检查接口/);
});

test('各功能基线不能允许角色提示词覆盖共同元认知', () => {
  const engineDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const baselines = [
    path.join(engineDir, 'conversation', 'baseline.md'),
    path.join(engineDir, 'convection', 'baseline.md'),
    path.join(engineDir, 'tradewind', 'execution', 'baseline.md'),
  ];

  for (const file of baselines) {
    const content = readFileSync(file, 'utf8');
    assert.doesNotMatch(content, /角色定义中有明确规范时，以角色定义为准/);
    assert.match(content, /不能覆盖前述共同立场/);
  }
});
