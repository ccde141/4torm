import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCycloneChairMeta, buildCycloneSeatMeta } from './meta-profiles.js';

test('气旋工位按私聊、群聊和联络区分当前身份', () => {
  const solo = buildCycloneSeatMeta('solo');
  const room = buildCycloneSeatMeta('room');
  const contact = buildCycloneSeatMeta('contact', '研究工位');

  for (const prompt of [solo, room, contact]) {
    assert.match(prompt, /平等的协作者/);
    assert.match(prompt, /长期工作室/);
    assert.doesNotMatch(prompt, /老板|下属/);
  }
  assert.match(solo, /一对一私聊/);
  assert.match(room, /群聊中的临时参与副本/);
  assert.match(contact, /无人值守的联络处理/);
  assert.match(contact, /研究工位/);
});

test('气旋会长保持独立判断并理解人类处境', () => {
  const prompt = buildCycloneChairMeta();

  assert.match(prompt, /平等的协作者/);
  assert.match(prompt, /私人参谋/);
  assert.match(prompt, /理解.*感受/);
  assert.match(prompt, /不以迎合代替判断/);
  assert.doesNotMatch(prompt, /老板|指挥工位/);
});
