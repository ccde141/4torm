import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { convectionDisplayMessages, editConvectionDisplay, retainConvectionDisplay } from './display-history.js';
import { createSession, loadSession, saveSession } from '../infrastructure/session-store.js';
import { convectionContext } from '../execution/compaction-context.js';

test('display history preserves raw evidence through repeated compactions without reentering model records', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'convection-display-history-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const session = await createSession(directory, { chairAgentId: 'chair', participantAgentIds: ['member'] });
  const request = { speaker: '人类', content: '原始要求', timestamp: 1 };
  const evidence = { speaker: 'member', content: '原始答复', reasoning: '原始思考', timestamp: 2,
    toolCalls: [{ tool: 'read', args: {}, result: '原始工具结果' }] };
  session.publicMessages = [request, evidence];
  const marker = { speaker: '系统', content: '[对话历史摘要]\n交接一', compactionId: 'compact-one', timestamp: 3 };
  const next = { ...session, publicMessages: [marker, request] };
  retainConvectionDisplay(session, next, marker);
  await saveSession(directory, next);
  const saved = (await loadSession(directory, session.id))!;
  assert.deepEqual(convectionDisplayMessages(saved).map(({ recordId: _id, ...record }) => record), [request, evidence, marker]);
  assert.equal(saved.publicMessages.some(message => message.toolCalls), false);
  saved.publicMessages.push({ speaker: '人类', content: '新要求', timestamp: 4 });
  const secondMarker = { speaker: '系统', content: '[对话历史摘要]\n交接二', compactionId: 'compact-two', timestamp: 5 };
  const second = { ...saved, publicMessages: [secondMarker, ...saved.publicMessages.filter(message => message.speaker === '人类')] };
  retainConvectionDisplay(saved, second, secondMarker);
  assert.equal(convectionDisplayMessages(second).filter(message => message.content === '原始答复').length, 1);
  assert.equal(editConvectionDisplay(second, 0, '修正原始要求'), true);
  assert.equal(second.publicMessages.find(message => message.timestamp === 1)?.content, '修正原始要求');
  assert.equal(editConvectionDisplay(second, 1), true);
  assert.equal(convectionDisplayMessages(second).some(message => message.content === '原始答复'), false);
  second.publicMessages.push({ speaker: 'member', content: '新的答复', timestamp: 6 });
  assert.equal(convectionDisplayMessages(second).at(-1)?.content, '新的答复');
});

test('a boundary rendered inside its agent turn suppresses the duplicated outer marker only', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'convection-display-inline-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const session = await createSession(directory, { chairAgentId: 'chair', participantAgentIds: ['member'] });
  session.publicDisplayHistory = [{ speaker: '人类', content: 'request', timestamp: 1 },
    { speaker: '系统', content: '[对话历史摘要]\nhandoff', timestamp: 2, compactionId: 'compact-one' }];
  session.publicDisplayContextCount = 1;
  session.publicMessages = [{ speaker: '系统', content: '[对话历史摘要]\nhandoff', timestamp: 2 },
    { speaker: 'member', content: 'after', timestamp: 3,
      compactions: [{ id: 'compact-one', summary: 'handoff', toolOffset: 1, textOffset: 6, reasoningOffset: 0 }] }];
  const projected = convectionDisplayMessages(session);
  assert.equal(projected.length, 2);
  assert.equal(projected[0].speaker, '人类');
  assert.equal(projected[1].compactions?.[0].id, 'compact-one');
});

test('editing repeated source records updates only their retained model counterpart after reload', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'convection-display-identities-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const session = await createSession(directory, { chairAgentId: 'chair', participantAgentIds: ['member'] });
  session.publicMessages = Array.from({ length: 6 }, () => ({ speaker: '人类', content: '相同要求', timestamp: 1 }));
  const marker = { speaker: '系统', content: '[对话历史摘要]\n交接', timestamp: 2, compactionId: 'compact-one' };
  const next = { ...session, publicMessages: [marker, ...session.publicMessages.slice(-4)] };
  retainConvectionDisplay(session, next, marker);
  await saveSession(directory, next);
  const saved = (await loadSession(directory, session.id))!;
  const humans = convectionDisplayMessages(saved).filter(message => message.speaker === '人类');
  assert.equal(new Set(humans.map(message => message.recordId)).size, 6);
  assert.deepEqual(saved.publicMessages.slice(1).map(message => message.recordId), humans.slice(-4).map(message => message.recordId));
  assert.equal(editConvectionDisplay(saved, 0, '只修改归档原文'), true);
  assert.equal(saved.publicMessages.slice(1).every(message => message.content === '相同要求'), true);
  assert.equal(editConvectionDisplay(saved, 2, '修改第三条要求'), true);
  assert.deepEqual(saved.publicMessages.slice(1).map(message => message.content),
    ['修改第三条要求', '相同要求', '相同要求', '相同要求']);
  assert.equal(editConvectionDisplay(saved, 3), true);
  assert.equal(saved.publicMessages.length, 4);
  assert.equal(saved.publicDisplayContextCount, 4);
  assert.equal(saved.publicMessages.some(message => message.recordId === humans[3].recordId), false);
  assert.equal(convectionDisplayMessages(saved).filter(message => message.speaker === '人类').length, 5);
});

test('editing a compacted reply replaces its model projection without restoring archived tool output', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'convection-edited-model-context-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const session = await createSession(directory, { chairAgentId: 'chair', participantAgentIds: ['member'] });
  session.publicMessages = [{ recordId: 'reply', speaker: 'member', content: '原答复', timestamp: 1,
    modelContent: '[assistant]\n原投影', toolCalls: [{ tool: 'read', args: {}, result: '旧工具证据' }] }];
  session.publicDisplayHistory = structuredClone(session.publicMessages);
  session.publicDisplayContextCount = 1;
  await saveSession(directory, session);
  const saved = (await loadSession(directory, session.id))!;
  assert.equal(editConvectionDisplay(saved, 0, '人类修正后的答复'), true);
  assert.match(convectionContext(saved.publicMessages)[0].content, /人类修正后的答复/);
  assert.doesNotMatch(convectionContext(saved.publicMessages)[0].content, /原投影|旧工具证据/);
  assert.equal(saved.publicMessages[0].toolCalls?.[0].result, '旧工具证据');
});
