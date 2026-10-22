import assert from 'node:assert/strict';
import test from 'node:test';
import { broadcastToMeeting, setMeetingIdentity, clearMeetingIdentity, subscribeMeeting } from './meeting-broadcast.js';
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

test('same meeting node IDs stream only to subscribers of the exact execution', () => {
  const a: string[] = []; const b: string[] = [];
  setMeetingIdentity('same-node', 'wf-a', 'A');
  setMeetingIdentity('same-node', 'wf-b', 'B');
  const stopA = subscribeMeeting('same-node', event => a.push(event.type), 'A');
  const stopB = subscribeMeeting('same-node', event => b.push(event.type), 'B');
  try {
    broadcastToMeeting('same-node', { type: 'phase-change', phase: 'discussion' }, 'A');
    assert.deepEqual(a, ['phase-change']); assert.deepEqual(b, []);
    assert.throws(() => broadcastToMeeting('same-node', { type: 'phase-change', phase: 'discussion' }), /execution|执行/);
    clearMeetingIdentity('same-node', 'A');
    broadcastToMeeting('same-node', { type: 'phase-change', phase: 'discussion' }, 'B');
    assert.deepEqual(b, ['phase-change']);
  } finally { stopA(); stopB(); clearMeetingIdentity('same-node', 'A'); clearMeetingIdentity('same-node', 'B'); }
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
