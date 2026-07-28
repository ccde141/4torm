import assert from 'node:assert/strict';
import test from 'node:test';
import { phaseFromExecutionStatus, phasePresentation } from './execution-phase.js';

test('后端终态明确区分到达出口、停止和失败', () => {
  assert.equal(phaseFromExecutionStatus({ running: false, outcome: 'done' }, 'running'), 'completed');
  assert.equal(phaseFromExecutionStatus({ running: false, outcome: 'stopped' }, 'running'), 'stopped');
  assert.equal(phaseFromExecutionStatus({ running: false, outcome: 'error' }, 'running'), 'failed');
});

test('运行状态消失但没有终态时不伪装成已完成', () => {
  assert.equal(phaseFromExecutionStatus({ running: false }, 'running'), 'interrupted');
  assert.equal(phaseFromExecutionStatus({ running: false }, 'idle'), 'idle');
});

test('状态文案明确说明工作流是否到达 output', () => {
  assert.equal(phasePresentation.completed.label, '已到达出口 · 工作流完成');
  assert.equal(phasePresentation.stopped.label, '已停止 · 未到达出口');
  assert.equal(phasePresentation.failed.label, '执行失败 · 未到达出口');
});
