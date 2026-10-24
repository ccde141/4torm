import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { activeNodeRunners } from '../../../engine/tradewind/nodes/agent.js';
import { activeMeetings, type ActiveMeeting } from '../../../engine/tradewind/nodes/meeting.js';
import type { NodeRunner } from '../../../engine/tradewind/execution/node-runner.js';
import { createTradewindReadPort } from './read-adapter.js';
import { TokenUsageRecorder } from '../../../engine/tradewind/execution/token-usage.js';
import { createTradewindCommands } from './control-adapter.js';
import { createTradewindMeetingCommands } from './meeting-control-adapter.js';
import { createTradewindEventPort } from './event-adapter.js';

test('节点快照与会议状态公开原始工作流和执行身份', async () => {
  const nodeId = `node-${randomUUID()}`;
  const meetingId = `meeting-${randomUUID()}`;
  const compaction = { type: 'compact-start', id: 'compaction-1', operation: 'compact',
    reason: 'manual', startedAt: 1, updatedAt: 1 };
  activeNodeRunners.set(nodeId, {
    getIdentity: () => ({ workflowId: 'wf-1', executionId: 'exec-1' }),
    getDataDir: () => 'unused',
    getSnapshot: () => ({ messages: [], roundLog: [], busy: false, lastSeq: 0, compaction }),
    getCurrentInput: async () => undefined,
    isBusy: () => false,
  } as unknown as NodeRunner);
  activeMeetings.set(meetingId, {
    workflowId: 'wf-1', executionId: 'exec-1', roundIdentity: null,
    dataDir: 'unused',
    session: { busy: false, round: 0, phase: 'discussion', publicMessages: [],
      chairMessages: [], participants: [], chairAgentId: 'chair', streamingCurrent: null,
      compactions: { public: compaction },
      usageRecorder: new TokenUsageRecorder() },
    configuredParticipants: [],
  } as unknown as ActiveMeeting);
  try {
    const reads = createTradewindReadPort('unused');
    assert.deepEqual(await reads.nodeSnapshot(nodeId), {
      workflowId: 'wf-1', executionId: 'exec-1',
      messages: [], roundLog: [], busy: false, lastSeq: 0, compaction,
    });
    assert.deepEqual(reads.nodeStatus(nodeId), {
      workflowId: 'wf-1', executionId: 'exec-1', busy: false,
    });
    const meeting = await reads.meetingStatus(meetingId) as Record<string, unknown>;
    assert.equal(meeting.workflowId, 'wf-1');
    assert.equal(meeting.executionId, 'exec-1');
    assert.deepEqual(meeting.compactions, { public: compaction });
    const snapshots = createTradewindEventPort('unused').meeting(meetingId, 'exec-1').snapshots();
    assert.deepEqual((snapshots[0] as Record<string, unknown>).compactions, { public: compaction });
  } finally {
    activeNodeRunners.delete(nodeId);
    activeMeetings.delete(meetingId);
  }
});

test('a known foreign execution ID does not bypass data-root checks on live reads or round controls', async () => {
  const nodeId = `node-${randomUUID()}`; const meetingId = `meeting-${randomUUID()}`;
  let aborted = false;
  activeNodeRunners.set(nodeId, {
    getIdentity: () => ({ workflowId: 'wf-foreign', executionId: 'exec-foreign' }),
    getDataDir: () => 'root-B', getSnapshot: () => ({ messages: [{ role: 'user', content: 'private-B' }] }),
    getRoundIdentity: () => ({ runId: 'round-B' }), isBusy: () => true,
    abortRound: () => { aborted = true; return true; },
  } as unknown as NodeRunner);
  activeMeetings.set(meetingId, { workflowId: 'wf-foreign', executionId: 'exec-foreign', dataDir: 'root-B',
    session: { nodeId: meetingId }, roundIdentity: { runId: 'round-meeting-B' } } as unknown as ActiveMeeting);
  try {
    const reads = createTradewindReadPort('root-A');
    assert.throws(() => reads.nodeStatus(nodeId, { executionId: 'exec-foreign' }));
    assert.throws(() => reads.nodeStatus(nodeId));
    await assert.rejects(reads.nodeSnapshot(nodeId, { executionId: 'exec-foreign' }));
    assert.throws(() => reads.meetingStatus(meetingId, { executionId: 'exec-foreign' }));
    await assert.rejects(createTradewindCommands('root-A').abortNodeRound({ nodeId, runId: 'round-B' }));
    await assert.rejects(createTradewindCommands('root-A').abortMeetingRound({ nodeId: meetingId, runId: 'round-meeting-B' }));
    await assert.rejects(createTradewindMeetingCommands('root-A').join({ nodeId: meetingId,
      executionId: 'exec-foreign', participantNodeId: nodeId }));
    assert.equal(aborted, false);
  } finally { activeNodeRunners.delete(nodeId, 'exec-foreign'); activeMeetings.delete(meetingId, 'exec-foreign'); }
});
