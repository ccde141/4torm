import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRoomDispatchGuidance } from './seat-prompt.js';

test('群聊提示词要求把明确执行项主动派发，同时避免滥发', () => {
  const guidance = buildRoomDispatchGuidance('架构', [
    { title: '架构', duty: '维护总体设计' },
    { title: '后端', duty: '实现接口' },
  ]);

  assert.match(guidance, /主动调用 dispatch/);
  assert.match(guidance, /自己的固定工位「架构」/);
  assert.match(guidance, /尚未形成共识/);
  assert.match(guidance, /contact/);
  assert.match(guidance, /没有点名目标/);
  assert.match(guidance, /默认指你自己的固定工位「架构」/);
  assert.match(guidance, /不是群聊里的其他参与者/);
  assert.match(guidance, /明确点名/);
  assert.match(guidance, /重要信息.*dispatch/);
});
