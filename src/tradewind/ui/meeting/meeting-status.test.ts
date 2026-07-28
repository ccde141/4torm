import assert from 'node:assert/strict';
import test from 'node:test';
import { getMeetingPublicStateLabel } from './meeting-status.js';

test('结束会议期间明确显示会长正在整理纪要', () => {
  assert.equal(getMeetingPublicStateLabel({
    phase: 'discussion',
    busy: true,
    endingRequested: true,
    waitingLabel: '最后一个 Agent',
    waitingElapsed: 12,
  }), '会长整理会议纪要');
});

test('普通会议轮次继续显示当前响应者', () => {
  assert.equal(getMeetingPublicStateLabel({
    phase: 'discussion',
    busy: true,
    endingRequested: false,
    waitingLabel: '分析员',
    waitingElapsed: 3,
  }), '分析员 · 3s');
});
