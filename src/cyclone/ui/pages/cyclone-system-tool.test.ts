import assert from 'node:assert/strict';
import test from 'node:test';
import type { CycloneDispatch } from './dispatch-timeline.js';
import {
  describeCycloneSystemTool,
  isCycloneSystemTool,
} from './cyclone-system-tool.js';

function dispatch(status: CycloneDispatch['status']): CycloneDispatch {
  return {
    id: 'dispatch-a', workshopId: 'workshop-a', sourceKind: 'seat',
    sourceRoomId: '', sourceSeatId: 'seat-a', sourceSeatTitle: '发起者',
    sourceTurnId: 'turn-a', sourceRoundSeq: 1, dispatchOrder: 0,
    targetSeatId: 'seat-b', targetSeatTitle: '信息搜集者', task: '核对资料',
    status, readState: 'unread', decisionState: 'pending', receiptState: 'pending',
    error: status === 'failed' ? '目标工位执行失败' : undefined,
    createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:00:01.000Z',
  };
}

test('气旋只把具有独立业务语义的工具渲染为系统气泡', () => {
  assert.equal(isCycloneSystemTool('task_board'), true);
  assert.equal(isCycloneSystemTool('use_skill'), true);
  assert.equal(isCycloneSystemTool('dispatch'), true);
  assert.equal(isCycloneSystemTool('bulletin'), true);
  assert.equal(isCycloneSystemTool('read_file'), false);
});

test('dispatch 气泡关联异步任务并显示目标工位与真实失败', () => {
  const detail = describeCycloneSystemTool({
    tool: 'dispatch',
    args: { target: '信息搜集者', task: '核对资料' },
    result: '异步任务已送达「信息搜集者」，任务 ID：dispatch-a。',
    status: 'success',
    dispatches: [dispatch('failed')],
  });

  assert.equal(detail?.title, '异步派发 → 信息搜集者');
  assert.equal(detail?.state, '异步任务失败');
  assert.equal(detail?.status, 'error');
  assert.equal(detail?.preview, '目标工位执行失败');
});

test('系统工具取消不会显示为成功', () => {
  const detail = describeCycloneSystemTool({
    tool: 'bulletin',
    args: { action: 'remove', id: 'notice-a' },
    result: '（因等待用户回复而取消，未执行）',
    status: 'error',
    dispatches: [],
  });

  assert.equal(detail?.title, '公告板 · 删除条目');
  assert.equal(detail?.state, '已取消');
  assert.equal(detail?.status, 'cancelled');
});

test('系统工具成功结果中的未执行字样不被误判为取消', () => {
  const detail = describeCycloneSystemTool({
    tool: 'bulletin', args: { action: 'add', text: '记录未执行事项' },
    result: '已添加：未执行事项', status: 'success', dispatches: [],
  });

  assert.equal(detail?.state, '已完成');
  assert.equal(detail?.status, 'success');
});

test('技能与任务板气泡给出对象级摘要', () => {
  const skill = describeCycloneSystemTool({
    tool: 'use_skill', args: { skill: 'web-search' }, result: '技能内容',
    status: 'success', dispatches: [],
  });
  const board = describeCycloneSystemTool({
    tool: 'task_board', args: { action: 'set', goal: '完成冒烟测试' }, result: '任务板已更新',
    status: 'success', dispatches: [],
  });

  assert.equal(skill?.title, '加载技能 · web-search');
  assert.equal(board?.title, '任务板 · 更新');
  assert.equal(board?.preview, '完成冒烟测试');
});
