import assert from 'node:assert/strict';
import test from 'node:test';
import { broadcastToMeeting, setMeetingIdentity, clearMeetingIdentity } from './meeting-broadcast.js';
import { subscribeUnified } from './unified-stream.js';

test('会议统一流事件带注册时的工作流与执行身份', () => {
  const events: Array<Record<string, unknown>> = [];
  const unsubscribe = subscribeUnified(event => { if (event.nodeId === 'identity-meeting') events.push(event); });
  try {
    setMeetingIdentity('identity-meeting', 'wf-a', 'exec-a');
    broadcastToMeeting('identity-meeting', { type: 'phase-change', phase: 'discussion' });
    assert.deepEqual(events, [{ type: 'phase-change', phase: 'discussion',
      scope: 'meeting', nodeId: 'identity-meeting', workflowId: 'wf-a', executionId: 'exec-a' }]);
  } finally {
    clearMeetingIdentity('identity-meeting');
    unsubscribe();
  }
});

test('旧执行的迟到清理不能清除新执行的会议身份', () => {
  const events: Array<Record<string, unknown>> = [];
  const unsubscribe = subscribeUnified(event => { if (event.nodeId === 'reused-meeting') events.push(event); });
  try {
    setMeetingIdentity('reused-meeting', 'wf-old', 'exec-old');
    setMeetingIdentity('reused-meeting', 'wf-new', 'exec-new');
    clearMeetingIdentity('reused-meeting', 'exec-old');
    broadcastToMeeting('reused-meeting', { type: 'phase-change', phase: 'discussion' });
    assert.equal(events[0]?.workflowId, 'wf-new');
    assert.equal(events[0]?.executionId, 'exec-new');
  } finally {
    clearMeetingIdentity('reused-meeting');
    unsubscribe();
  }
});
