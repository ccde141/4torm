import assert from 'node:assert/strict';
import test from 'node:test';
import {
  abortActiveConvectionRound,
  clearActiveConvectionRound,
  getActiveConvectionRound,
  registerActiveConvectionRound,
} from './convection-active-round.js';

test('登记并清理会议室当前轮次', () => {
  const controller = new AbortController();
  registerActiveConvectionRound('conv-a', 'public', controller);
  assert.equal(getActiveConvectionRound('conv-a'), 'public');

  clearActiveConvectionRound('conv-a', controller);
  assert.equal(getActiveConvectionRound('conv-a'), null);
});

test('中止操作作用于会议室当前轮次', () => {
  const controller = new AbortController();
  registerActiveConvectionRound('conv-b', 'chair', controller);

  assert.equal(abortActiveConvectionRound('conv-b'), true);
  assert.equal(controller.signal.aborted, true);
  clearActiveConvectionRound('conv-b', controller);
});

test('旧轮次不能清除后来登记的新轮次', () => {
  const oldController = new AbortController();
  const currentController = new AbortController();
  registerActiveConvectionRound('conv-c', 'public', oldController);
  registerActiveConvectionRound('conv-c', 'chair', currentController);

  clearActiveConvectionRound('conv-c', oldController);
  assert.equal(getActiveConvectionRound('conv-c'), 'chair');
  clearActiveConvectionRound('conv-c', currentController);
});
