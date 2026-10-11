import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMeetingSession } from '../../../engine/tradewind/execution/meeting-session.js';
import { activeMeetings, type ActiveMeeting } from '../../../engine/tradewind/nodes/meeting.js';
import { createTradewindMeetingCommands } from './meeting-control-adapter.js';
import { subscribeMeeting } from '../../../engine/tradewind/streaming/meeting-broadcast.js';

const writer = { nodeId: 'writer', agentId: 'agent-w', label: '撰写' };
const reviewer = { nodeId: 'reviewer', agentId: 'agent-r', label: '复核' };

test('会议成员调整校验执行身份和完整顺序', async t => {
  const session = createMeetingSession({ nodeId: 'meeting-1', meetingLabel: '评审',
    chairAgentId: 'chair', participants: [writer], topic: '发布' });
  session.phase = 'discussion';
  activeMeetings.set('meeting-1', meeting(session));
  t.after(() => { activeMeetings.delete('meeting-1'); });
  const commands = createTradewindMeetingCommands();

  await commands.join({ executionId: 'exec-1', nodeId: 'meeting-1', participantNodeId: 'reviewer' });
  assert.deepEqual(session.participants.map(item => item.nodeId), ['writer', 'reviewer']);
  await commands.reorder({ executionId: 'exec-1', nodeId: 'meeting-1', order: ['reviewer', 'writer'] });
  assert.deepEqual(session.participants.map(item => item.nodeId), ['reviewer', 'writer']);
  await assert.rejects(commands.reorder({ executionId: 'exec-1', nodeId: 'meeting-1',
    order: ['writer'] }), hasCode('TRADEWIND_MEETING_ORDER_INVALID'));
  await assert.rejects(commands.join({ executionId: 'stale', nodeId: 'meeting-1',
    participantNodeId: 'reviewer' }), hasCode('TRADEWIND_EXECUTION_CHANGED'));
});

test('会议轮次进行时拒绝修改成员', async t => {
  const session = createMeetingSession({ nodeId: 'meeting-1', meetingLabel: '评审',
    chairAgentId: 'chair', participants: [writer], topic: '发布' });
  session.phase = 'discussion'; session.busy = true;
  activeMeetings.set('meeting-1', meeting(session));
  t.after(() => { activeMeetings.delete('meeting-1'); });

  await assert.rejects(createTradewindMeetingCommands().join({
    executionId: 'exec-1', nodeId: 'meeting-1', participantNodeId: 'reviewer',
  }), hasCode('TRADEWIND_MEETING_ROUND_ACTIVE'));
});

test('rejected human input keeps compaction notice, accepted reset clears it and holds a round lock', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-notice-'));
  const session = createMeetingSession({ nodeId: 'meeting-notice', meetingLabel: '评审',
    chairAgentId: 'chair', participants: [writer], topic: '发布' });
  session.phase = 'discussion'; session.busy = true; session.compactionNotice = '主压缩模型离线';
  session.publicMessages.push({ speaker: '人类', content: '历史原文', timestamp: 1 });
  const live = { ...meeting(session), runDir: directory, compactArchiveDir: path.join(directory, 'bak') };
  activeMeetings.set(session.nodeId, live);
  const events: string[] = [];
  const unsubscribe = subscribeMeeting(session.nodeId, event => events.push(event.type));
  t.after(async () => { unsubscribe(); activeMeetings.delete(session.nodeId);
    await fs.rm(directory, { recursive: true, force: true }); });
  const commands = createTradewindMeetingCommands();
  const input = { executionId: 'exec-1', nodeId: session.nodeId, message: '/reset' };
  await assert.rejects(commands.speak(input), hasCode('TRADEWIND_MEETING_ROUND_ACTIVE'));
  assert.equal(session.compactionNotice, '主压缩模型离线');
  assert.deepEqual(events, []);
  session.busy = false;
  const accepted = commands.speak(input);
  assert.equal(session.busy, true);
  await assert.rejects(commands.speak(input), hasCode('TRADEWIND_MEETING_ROUND_ACTIVE'));
  await accepted;
  assert.equal(session.compactionNotice, undefined);
  assert.deepEqual(session.publicMessages, []);
  assert.deepEqual(events, ['compaction-notice-clear', 'round-start', 'round-done', 'history-updated']);
});

function meeting(session: ReturnType<typeof createMeetingSession>): ActiveMeeting {
  return { session, configuredParticipants: [writer, reviewer], resolve: () => {},
    executionId: 'exec-1', dataDir: '', runDir: '', workspace: '',
    signal: new AbortController().signal, roundAbort: null, roundIdentity: null,
    compactArchiveDir: '', teamRoster: [] };
}

function hasCode(code: string) {
  return (error: unknown) => (error as { data?: { code?: string } }).data?.code === code;
}
