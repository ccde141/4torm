import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChairContext, finishChairContext } from './chair-context-compaction.js';
import { createMeetingSession } from './meeting-session.js';

test('chair private projection carries the exact summary plus newly observed public and private messages', () => {
  const session = createMeetingSession({ nodeId: 'meeting', meetingLabel: '评审',
    chairAgentId: 'chair', participants: [], topic: '方案' });
  session.publicMessages = [{ speaker: '人类', content: '旧公开问题', timestamp: 1 },
    { speaker: '撰写', content: '旧公开结果', timestamp: 2 }];
  session.chairMessages = [{ role: 'user', content: '旧私聊' }, { role: 'assistant', content: '旧私聊答复' }];
  session.chairActiveContext = [{ role: 'system', content: '私聊摘要' }];
  session.chairContextRawCount = 2;
  session.chairContextPublicAnchor = { timestamp: 2, content: '旧公开结果' };
  session.publicMessages.push({ speaker: '人类', content: '新公开问题', timestamp: 3 });
  session.chairMessages.push({ role: 'user', content: '新私聊问题' });
  const messages = buildChairContext({ role: 'system', content: '静态职责' }, session);
  assert.deepEqual(messages.map(message => message.content),
    ['静态职责', '私聊摘要', '[人类] 新公开问题', '新私聊问题']);
  const publicBefore = structuredClone(session.publicMessages);
  const answer = { role: 'assistant' as const, content: '私聊答复' };
  session.chairMessages.push(answer);
  finishChairContext(session, messages, answer);
  session.chairMessages.push({ role: 'user', content: '下一次提问' });
  assert.deepEqual(buildChairContext(messages[0], session).map(message => message.content),
    [...messages.map(message => message.content), '私聊答复', '下一次提问']);
  assert.deepEqual(session.publicMessages, publicBefore);
  assert.equal(session.chairMessages[0].content, '旧私聊');
});
