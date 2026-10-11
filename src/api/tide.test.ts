import assert from 'node:assert/strict';
import test from 'node:test';
import { createTask, deleteTask, runNow, toggleTask, updateTask } from './tide.js';

test('潮汐写操作只调用中心协作入口并消费中心回执', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: String(input), body });
    if (body.method === 'createTask') return Response.json({ task: { id: 'task-1', name: 'created' } });
    if (body.method === 'updateTask') return Response.json({ task: { id: 'task-1', name: 'updated' } });
    if (body.method === 'toggleTask') return Response.json({ task: { id: 'task-1', enabled: false } });
    if (body.method === 'deleteTask') return Response.json({ taskId: 'task-1', deleted: true });
    return Response.json({ operationId: 'task-1', taskId: 'task-1', accepted: true, runId: 'tide-run-1' });
  };
  try {
    assert.equal((await createTask({
      name: 'created', schedule: 'every 1h', prompt: 'work', agentId: 'agent-a',
    })).name, 'created');
    assert.equal((await updateTask('task-1', { name: 'updated' })).name, 'updated');
    assert.equal((await toggleTask('task-1')).enabled, false);
    await deleteTask('task-1');
    assert.deepEqual(await runNow('task-1'), {
      ok: true, accepted: true, runId: 'tide-run-1',
    });
    assert.deepEqual(calls.map(call => call.url), Array(5).fill('/api/collaboration/invoke'));
    assert.deepEqual(calls.map(call => call.body.method), [
      'createTask', 'updateTask', 'toggleTask', 'deleteTask', 'runTask',
    ]);
    assert.ok(calls.every(call => call.body.feature === 'tide'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
