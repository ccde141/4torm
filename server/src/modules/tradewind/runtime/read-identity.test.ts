import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { activeNodeRunners } from '../../../engine/tradewind/nodes/agent.js';
import { activeMeetings, type ActiveMeeting } from '../../../engine/tradewind/nodes/meeting.js';
import type { NodeRunner } from '../../../engine/tradewind/execution/node-runner.js';
import { createTradewindReadPort } from './read-adapter.js';
import { TokenUsageRecorder } from '../../../engine/tradewind/execution/token-usage.js';

test('节点快照与会议状态公开原始工作流和执行身份', async () => {
  const nodeId = `node-${randomUUID()}`;
  const meetingId = `meeting-${randomUUID()}`;
  activeNodeRunners.set(nodeId, {
    getIdentity: () => ({ workflowId: 'wf-1', executionId: 'exec-1' }),
    getSnapshot: () => ({ messages: [], roundLog: [], busy: false, lastSeq: 0 }),
    isBusy: () => false,
  } as unknown as NodeRunner);
  activeMeetings.set(meetingId, {
    workflowId: 'wf-1', executionId: 'exec-1', roundIdentity: null,
    session: { busy: false, round: 0, phase: 'discussion', publicMessages: [],
      chairMessages: [], participants: [], chairAgentId: 'chair', streamingCurrent: null,
      usageRecorder: new TokenUsageRecorder() },
    configuredParticipants: [],
  } as unknown as ActiveMeeting);
  try {
    const reads = createTradewindReadPort('unused');
    assert.deepEqual(await reads.nodeSnapshot(nodeId), {
      workflowId: 'wf-1', executionId: 'exec-1',
      messages: [], roundLog: [], busy: false, lastSeq: 0,
    });
    assert.deepEqual(reads.nodeStatus(nodeId), {
      workflowId: 'wf-1', executionId: 'exec-1', busy: false,
    });
    const meeting = reads.meetingStatus(meetingId) as Record<string, unknown>;
    assert.equal(meeting.workflowId, 'wf-1');
    assert.equal(meeting.executionId, 'exec-1');
  } finally {
    activeNodeRunners.delete(nodeId);
    activeMeetings.delete(meetingId);
  }
});
