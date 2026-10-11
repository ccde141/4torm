import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMeetingSession } from '../../../engine/tradewind/execution/meeting-session.js';
import type { ActiveMeeting } from '../../../engine/tradewind/nodes/meeting.js';
import { resetMeetingHistory } from './meeting-history-management.js';

function fixture(directory: string): ActiveMeeting {
  const session = createMeetingSession({ nodeId: 'meeting', meetingLabel: '评审',
    chairAgentId: 'chair', participants: [], topic: '方案' });
  session.publicMessages = [{ speaker: '人类', content: '公开原文', timestamp: 1 }];
  session.chairMessages = [{ role: 'user', content: '私聊原文' }];
  session.chairActiveContext = [{ role: 'system', content: '私聊摘要' }];
  session.chairContextRawCount = 1;
  session.chairContextPublicAnchor = { timestamp: 1, content: '公开原文' };
  return { session, dataDir: directory, runDir: directory, executionId: 'execution', workspace: '',
    signal: new AbortController().signal, roundAbort: null, roundIdentity: null,
    configuredParticipants: [], resolve: () => {}, teamRoster: [],
    compactArchiveDir: path.join(directory, 'bak') };
}

test('meeting reset archives originals, clears both contexts, and invalidates only the prompt measurement', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-reset-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const meeting = fixture(directory);
  await meeting.session.usageRecorder.record({ promptTokens: 90, completionTokens: 10, totalTokens: 100 });
  await resetMeetingHistory('meeting', meeting);
  assert.deepEqual(meeting.session.publicMessages, []);
  assert.deepEqual(meeting.session.chairMessages, []);
  assert.equal(meeting.session.chairActiveContext, undefined);
  assert.equal(meeting.session.usageRecorder.state.latest, null);
  assert.equal(meeting.session.usageRecorder.state.calls, 1);
  assert.equal(meeting.session.usageRecorder.state.total.totalTokens, 100);
  const [name] = await fs.readdir(meeting.compactArchiveDir);
  const archive = JSON.parse(await fs.readFile(path.join(meeting.compactArchiveDir, name), 'utf8'));
  assert.equal(archive.publicMessages[0].content, '公开原文');
  assert.equal(archive.chairMessages[0].content, '私聊原文');
});

test('failed reset persistence leaves the live public and private originals visible', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-reset-fail-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const meeting = fixture(directory);
  const invalid = path.join(directory, 'file-instead-of-directory');
  await fs.writeFile(invalid, 'occupied');
  meeting.runDir = invalid;
  await assert.rejects(resetMeetingHistory('meeting', meeting));
  assert.equal(meeting.session.publicMessages[0].content, '公开原文');
  assert.equal(meeting.session.chairMessages[0].content, '私聊原文');
  assert.equal(meeting.session.chairActiveContext?.[0].content, '私聊摘要');
  assert.equal((await fs.readdir(meeting.compactArchiveDir)).length, 1);
});
