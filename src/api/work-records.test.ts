import assert from 'node:assert/strict';
import test from 'node:test';
import { listWorkRecords, readWorkRecord, type WorkRecord } from './work-records';

const record: WorkRecord = { id: `work:${'a'.repeat(64)}`, revision: 'b'.repeat(64), title: 'Project',
  summary: 'A saved handoff', timestamp: '2026-11-01T00:00:00Z' };
test('work records use owner-scoped module queries, bounded bodies and cancellable requests', async t => {
  const calls: Array<{ input: Record<string, unknown>; signal?: AbortSignal | null }> = [];
  t.mock.method(globalThis, 'fetch', async (_input, init) => {
    calls.push({ input: JSON.parse(String(init?.body)), signal: init?.signal });
    return Response.json({ items: [record], total: 1 });
  });
  const control = new AbortController();
  await listWorkRecords('agent-a', { date: '2026-11-01' }, control.signal);
  await readWorkRecord('agent-a', record, { view: 'source', offset: 6000 }, control.signal);
  assert.equal(calls[0].input.feature, 'monsoon'); assert.equal(calls[0].input.method, 'listWorkRecords');
  assert.deepEqual(calls[0].input.input, { agentId: 'agent-a', date: '2026-11-01', limit: 20 });
  assert.deepEqual(calls[1].input.input, { agentId: 'agent-a', id: record.id, revision: record.revision,
    view: 'source', offset: 6000, limit: 6000 });
  assert.equal(calls[0].signal, control.signal);
});
test('a changed record exposes its stable error code without retrying an obsolete revision', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++;
    return Response.json({ error: 'Changed', errorCode: 'WORK_RECORD_CHANGED', errorKind: 'conflict' }, { status: 409 });
  });
  await assert.rejects(readWorkRecord('agent-a', record, { view: 'record', offset: 0 }),
    (error: unknown) => (error as { code: string }).code === 'WORK_RECORD_CHANGED');
  assert.equal(calls, 1);
});
