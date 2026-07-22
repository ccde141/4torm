import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getConvectionComposerMode,
  normalizeConvectionRound,
  shouldBlockConvectionSessionSwitch,
} from './convection-round-state.js';

test('公共轮次运行时仅公共输入允许排队', () => {
  assert.equal(getConvectionComposerMode('public', 'public'), 'running');
  assert.equal(getConvectionComposerMode('public', 'chair'), 'blocked');
});

test('会长轮次运行时公共输入被阻止', () => {
  assert.equal(getConvectionComposerMode('chair', 'chair'), 'running');
  assert.equal(getConvectionComposerMode('chair', 'public'), 'blocked');
});

test('服务端运行态只接受公开的轮次值', () => {
  assert.equal(normalizeConvectionRound('public'), 'public');
  assert.equal(normalizeConvectionRound('chair'), 'chair');
  assert.equal(normalizeConvectionRound('stale'), null);
  assert.equal(normalizeConvectionRound(undefined), null);
});

test('本地轮次运行中不能切换到另一会议室', () => {
  assert.equal(shouldBlockConvectionSessionSwitch('conv-a', 'conv-b', true), true);
  assert.equal(shouldBlockConvectionSessionSwitch('conv-a', 'conv-a', true), false);
  assert.equal(shouldBlockConvectionSessionSwitch('conv-a', 'conv-b', false), false);
});
