import assert from 'node:assert/strict';
import test from 'node:test';
import { getMeetingPublicStateLabel } from './meeting-status.js';
import { resolveMessage, type MessageKey, type MessageValues } from '../../../i18n/locale.js';

const t = (key: MessageKey, values?: MessageValues) => resolveMessage('zh-CN', key, values);

test('结束会议期间明确显示会议助理正在整理纪要', () => {
  assert.equal(getMeetingPublicStateLabel({
    phase: 'discussion',
    busy: true,
    endingRequested: true,
    waitingLabel: '最后一个 Agent',
    waitingElapsed: 12,
  }, t), '会议助理整理会议纪要');
});

test('普通会议轮次继续显示当前响应者', () => {
  assert.equal(getMeetingPublicStateLabel({
    phase: 'discussion',
    busy: true,
    endingRequested: false,
    waitingLabel: '分析员',
    waitingElapsed: 3,
  }, t), '分析员 · 3s');
});
