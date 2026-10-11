import assert from 'node:assert/strict';
import test from 'node:test';
import { applyExternalChairEvent, applyExternalPublicEvent } from './convection-external-events.js';

test('后台会议的逐字发言在前端形成流式卡片并由终答收口', () => {
  const start = applyExternalPublicEvent([], {
    type: 'agent-start', agentId: 'agent-a', label: '研究员',
  });
  const streaming = applyExternalPublicEvent(start, {
    type: 'token', agentId: 'agent-a', label: '研究员', chunk: '正在核对',
  });
  assert.equal(streaming[0]?.content, '正在核对');
  assert.equal(streaming[0]?.streaming, true);
  const done = applyExternalPublicEvent(streaming, {
    type: 'agent-done', agentId: 'agent-a', label: '研究员',
    content: '核对完成', rawContent: '核对完成', toolCalls: [],
  });
  assert.equal(done[0]?.content, '核对完成');
  assert.equal(done[0]?.streaming, false);
});

test('中途订阅时缺失 agent-start 仍能显示后续片段；助理私聊也逐字更新', () => {
  const publicMessages = applyExternalPublicEvent([], {
    type: 'token', agentId: 'agent-a', label: '研究员', chunk: '续写',
  });
  assert.equal(publicMessages[0]?.content, '续写');
  const resumed = applyExternalPublicEvent([{
    speaker: '研究员', content: '已有', streaming: true,
  }], { type: 'token', agentId: 'agent-a', label: '研究员', chunk: '续写' });
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0]?.content, '已有续写');
  const chair = applyExternalChairEvent([], { type: 'chair-token', chunk: '先看' });
  assert.equal(chair[0]?.content, '先看');
  assert.equal(applyExternalChairEvent(chair, {
    type: 'chair-done', content: '先看事实',
  })[0]?.streaming, false);
});
