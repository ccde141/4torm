import assert from 'node:assert/strict';
import test from 'node:test';
import { tideRefreshTargets } from './tide-change-routing.js';

test('其他 Agent 或调度器保存同一任务运行记录会刷新已打开的历史', () => {
  const identity = { agentId: 'worker', selection: {
    kind: 'task' as const, agentId: 'worker', taskId: 'task-a',
  } };
  assert.deepEqual(tideRefreshTargets(identity, { type: 'change', scope: 'record',
    taskId: 'task-a', runId: 'run-2', revision: 4 }), {
    overview: true, sessions: false, task: true, session: false,
  });
  assert.equal(tideRefreshTargets(identity, { type: 'change', scope: 'record',
    taskId: 'task-b', runId: 'run-3', revision: 5 }).task, false);
});

test('指定会话追加通知只刷新当前 Agent 的会话列表和同身份详情', () => {
  const identity = { agentId: 'worker', selection: {
    kind: 'session' as const, agentId: 'worker', sessionId: 'session-1',
  } };
  assert.deepEqual(tideRefreshTargets(identity, { type: 'change', scope: 'session',
    agentId: 'worker', sessionId: 'session-1', taskId: 'task-a', revision: 6 }), {
    overview: true, sessions: true, task: false, session: true,
  });
});

test('bound task runtime updates refresh the current Agent session without waiting for a full turn', () => {
  const identity = { agentId: 'worker', selection: {
    kind: 'session' as const, agentId: 'worker', sessionId: 'session-1',
  } };
  assert.equal(tideRefreshTargets(identity, { type: 'change', scope: 'run', taskId: 'task-a',
    runId: 'run-a', agentId: 'worker', revision: 7 }).session, true);
  assert.equal(tideRefreshTargets(identity, { type: 'change', scope: 'run', taskId: 'task-b',
    runId: 'run-b', agentId: 'other', revision: 8 }).session, false);
});
