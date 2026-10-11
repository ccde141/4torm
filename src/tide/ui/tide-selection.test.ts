import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptsTideResponse,
  selectTideAgent,
  selectTideSession,
  selectTideTask,
} from './tide-selection.js';

test('切换 Agent 立即丢弃上一个 Agent 的任务和会话选择', () => {
  const openA = selectTideSession({ agentId: 'a', selection: null }, 'a', 'shared');
  const switched = selectTideAgent(openA, 'b');
  assert.deepEqual(switched, { agentId: 'b', selection: null });
  assert.equal(acceptsTideResponse(switched, openA.selection), false);
  assert.equal(acceptsTideResponse(
    selectTideSession(switched, 'b', 'shared'), openA.selection,
  ), false, '同名 sessionId 不能跨 Agent 命中');
});

test('迟到的手动运行和详情结果只能写回当前任务身份', () => {
  const taskA = selectTideTask({ agentId: 'a', selection: null }, 'a', 'task-a');
  const taskB = selectTideTask(selectTideAgent(taskA, 'b'), 'b', 'task-b');
  assert.equal(acceptsTideResponse(taskB, taskA.selection), false);
  assert.equal(acceptsTideResponse(taskB, taskB.selection), true);
});
