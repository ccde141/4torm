import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildConvectionChairPrompt,
  buildConvectionParticipantMeta,
} from './prompt-profiles.js';

test('对流参与者继承共同立场并独立推进公共讨论', () => {
  const prompt = buildConvectionParticipantMeta();

  assert.match(prompt, /平等的协作者/);
  assert.match(prompt, /独立判断/);
  assert.match(prompt, /公共讨论/);
  assert.match(prompt, /不重复已有观点/);
});

test('对流会长是理解处境但不迎合的私人参谋', () => {
  const prompt = buildConvectionChairPrompt({
    chairName: '会长甲',
    rolePrompt: '你擅长风险判断。',
    topic: '发布方案',
    publicContext: '[成员] 建议立即发布',
  });

  assert.match(prompt, /平等的协作者/);
  assert.match(prompt, /私人参谋/);
  assert.match(prompt, /不参与公共讨论/);
  assert.match(prompt, /理解.*感受/);
  assert.match(prompt, /不以迎合代替判断/);
  assert.match(prompt, /你擅长风险判断/);
  assert.match(prompt, /发布方案/);
});
