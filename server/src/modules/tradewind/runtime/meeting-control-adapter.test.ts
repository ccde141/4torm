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
  const commands = createTradewindMeetingCommands('');

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

  await assert.rejects(createTradewindMeetingCommands('').join({
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
  const unsubscribe = subscribeMeeting(session.nodeId, event => events.push(event.type), live.executionId);
  t.after(async () => { unsubscribe(); activeMeetings.delete(session.nodeId);
    await fs.rm(directory, { recursive: true, force: true }); });
  const commands = createTradewindMeetingCommands('');
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
  assert.deepEqual(events, ['compaction-notice-clear', 'round-start', 'compact-start', 'compact-done',
    'round-done', 'history-updated']);
});

for (const target of ['public', 'chair'] as const) {
  test(`intentional ${target} compaction cancellation is not rebroadcast as a provider connection failure`, async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-abort-provider-'));
    await fs.mkdir(path.join(directory, 'agents'), { recursive: true });
    await fs.writeFile(path.join(directory, 'agents', 'registry.json'), JSON.stringify({
      chair: { name: '会长', model: 'p:chair', config: {} },
    }));
    await fs.writeFile(path.join(directory, 'providers.json'), JSON.stringify({ providers: [
      { id: 'p', baseUrl: 'https://summary.test/v1', models: ['chair'], nativeMode: 'text' },
    ] }));
    const session = createMeetingSession({ nodeId: `abort-${target}`, meetingLabel: '交付评审',
      chairAgentId: 'chair', participants: [writer], topic: '交付' });
    session.phase = 'discussion';
    session.publicMessages = [{ speaker: '人类', content: '原始公开记录'.repeat(300), timestamp: 1 }];
    session.chairMessages = [{ role: 'user', content: '原始私聊记录'.repeat(300) }];
    const before = { public: structuredClone(session.publicMessages), chair: structuredClone(session.chairMessages) };
    const live = { ...meeting(session), dataDir: directory, runDir: directory,
      compactArchiveDir: path.join(directory, 'bak') };
    activeMeetings.set(session.nodeId, live);
    const events: string[] = [];
    const unsubscribe = subscribeMeeting(session.nodeId, event => events.push(event.type), live.executionId);
    const originalFetch = globalThis.fetch;
    let started!: () => void;
    const providerStarted = new Promise<void>(resolve => { started = resolve; });
    globalThis.fetch = async (_input, options) => new Promise((_resolve, reject) => {
      started();
      options?.signal?.addEventListener('abort', () => reject(new Error('fetch failed')), { once: true });
    });
    t.after(async () => { globalThis.fetch = originalFetch; unsubscribe(); activeMeetings.delete(session.nodeId);
      await fs.rm(directory, { recursive: true, force: true }); });
    const abort = new AbortController(), commands = createTradewindMeetingCommands(directory);
    const input = { executionId: live.executionId, nodeId: session.nodeId, message: '/compact' };
    const run = target === 'public' ? commands.speak(input, { signal: abort.signal })
      : commands.messageChair(input, { signal: abort.signal });
    await providerStarted;
    abort.abort();
    await assert.rejects(run, hasCode('TRADEWIND_COMPACTION_CANCELLED'));
    assert.equal(session.compactions?.[target]?.type, 'compact-failed');
    assert.equal(session.compactions?.[target]?.aborted, true);
    assert.equal(events.includes('error'), false);
    assert.deepEqual(session.publicMessages, before.public);
    assert.deepEqual(session.chairMessages, before.chair);
  });
}

function meeting(session: ReturnType<typeof createMeetingSession>): ActiveMeeting {
  return { session, configuredParticipants: [writer, reviewer], resolve: () => {},
    executionId: 'exec-1', dataDir: '', runDir: '', workspace: '',
    signal: new AbortController().signal, roundAbort: null, roundIdentity: null,
    compactArchiveDir: '', teamRoster: [] };
}

function hasCode(code: string) {
  return (error: unknown) => (error as { data?: { code?: string } }).data?.code === code;
}
