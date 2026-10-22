import assert from 'node:assert/strict';
import test from 'node:test';

import { saveTaskboard, TaskboardConflictError, type TaskBoard } from './taskboard.js';

const board: TaskBoard = {
  goal: '交付',
  tasks: [{ id: 't1', title: '实现', status: 'doing' }],
  updatedAt: 1,
  revision: 3,
};

test('browser taskboard edits use the CAS route and adopt its next revision', async t => {
  let requestBody: Record<string, unknown> | undefined;
  t.mock.method(globalThis, 'fetch', async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      result: '任务板已更新',
      meta: { taskboard: { ...board, revision: 4 } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });

  const saved = await saveTaskboard('agent-a-session-1', board);
  assert.equal(requestBody?.expectedRevision, 3);
  assert.equal(requestBody?.action, 'set');
  assert.equal(saved?.revision, 4);
});

test('browser receives the authoritative board when its revision is stale', async t => {
  const current = { ...board, revision: 5 };
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    result: '任务板版本冲突', meta: { taskboard: current }, conflict: true,
  }), { status: 409, headers: { 'Content-Type': 'application/json' } }));

  await assert.rejects(
    saveTaskboard('agent-a-session-1', board),
    (error: unknown) => error instanceof TaskboardConflictError && error.current?.revision === 5,
  );
});

test('browser preserves its board by rejecting explicit backend storage failure', async t => {
  for (const status of [200, 500]) {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
      result: '任务板数据损坏，原文件已保留，请修复后再继续。', ok: false, errorCode: 'TASKBOARD_STORE_CORRUPT',
    }), { status, headers: { 'Content-Type': 'application/json' } }));
    await assert.rejects(saveTaskboard('agent-a-session-1', board), /任务板数据损坏/);
  }
});
