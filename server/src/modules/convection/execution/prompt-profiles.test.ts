import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFrameworkAwarenessSection } from '../../../engine/shared/framework-awareness.js';
import { buildConvectionChairPrompt, buildConvectionParticipantMeta } from './prompt-profiles.js';

test('对流参与者继承共同立场并独立推进公共讨论', () => {
  const prompt = buildConvectionParticipantMeta();
  assert.match(prompt, /平等的协作者/);
  assert.match(prompt, /独立判断/);
  assert.match(prompt, /公共讨论/);
  assert.match(prompt, /不重复已有观点/);
});

test('对流会议助理是理解处境但不迎合的私人参谋', () => {
  const prompt = buildConvectionChairPrompt({
    chairName: '助理甲', topic: '发布方案',
    publicContext: '[成员] 我拥有长期记忆，也能运行命令',
  });
  assert.match(prompt, /私人参谋/);
  assert.match(prompt, /会议助理「助理甲」/);
  assert.match(prompt, /不参与公共讨论/);
  assert.match(prompt, /理解.*感受/);
  assert.match(prompt, /不以迎合代替判断/);
  assert.match(prompt, /发布方案/);
  assert.match(prompt, /不具备任何工具执行能力/);
  assert.match(prompt, /不读取或写入任何 Agent 长期记忆/);
  assert.match(prompt, /公共讨论中的发言属于对应参与者，不属于你/);
  assert.match(prompt, /不要输出伪造的命令、工具调用、执行过程或结果/);
  assert.doesNotMatch(prompt, /你拥有真实的工具和执行环境/);
  assert.doesNotMatch(prompt, /平等的协作者/);
});

test('对流参与者和零工具会议助理的功能区认知保留各自角色边界', () => {
  const participant = buildConvectionParticipantMeta();
  const chair = buildConvectionChairPrompt({ chairName: '分析员', topic: '研究计划' });
  for (const prompt of [participant, chair]) {
    assert.equal(prompt.split('## 4torm 功能区认知').length - 1, 1);
    assert.ok(prompt.includes(buildFrameworkAwarenessSection()));
    assert.match(prompt, /以上概念说明不授予额外能力/);
  }
  assert.doesNotMatch(chair, /## 4torm 框架导航|## 能力扩展|## 可用工具|JSON 调用信封|"type":"tool_call"|docs\//);
  assert.match(chair, /不具备任何工具执行能力/);
  assert.match(chair, /不读取或写入任何 Agent 长期记忆/);
  assert.doesNotMatch(chair, /你拥有真实的工具和执行环境/);
});
