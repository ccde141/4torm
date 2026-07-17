import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSubAgentModel } from './sub-agent-model';

test('SubAgent 优先继承母会话的临时模型', () => {
  assert.equal(resolveSubAgentModel('deepseek/deepseek-v4', 'lmstudio/local'), 'deepseek/deepseek-v4');
});

test('没有会话覆盖时保持 Agent 默认模型', () => {
  assert.equal(resolveSubAgentModel(undefined, 'lmstudio/local'), 'lmstudio/local');
});
