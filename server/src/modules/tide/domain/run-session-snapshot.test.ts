import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileTideRunRepository } from '../infrastructure/run-repository.js';
import { parseTideRunRecord } from './run.js';

const record = {
  taskId: 'task-a', timestamp: '2026-10-21T00:00:00.000Z', status: 'success' as const,
  sessionId: 'session-a', answer: 'done', rawContent: 'done', toolCalls: [], turns: 1, durationMs: 5,
};

test('会话归属与保存后状态随运行记录持久化，旧记录缺少字段时不推断归档', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-session-snapshot-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const runs = new FileTideRunRepository(directory);
  await runs.save({ ...record, runId: 'retained', agentId: 'original-agent',
    pushMode: 'designated', sessionState: 'retained' });
  await runs.save({ ...record, runId: 'archived', agentId: 'original-agent',
    pushMode: 'accumulate', sessionState: 'archived' });
  await runs.save({ ...record, runId: 'legacy' });
  const retained = await runs.get(record.taskId, 'retained');
  assert.equal(retained?.agentId, 'original-agent');
  assert.equal(retained?.pushMode, 'designated');
  assert.equal(retained?.sessionState, 'retained');
  assert.equal((await runs.get(record.taskId, 'archived'))?.sessionState, 'archived');
  assert.equal((await runs.get(record.taskId, 'legacy'))?.sessionState, undefined);
  assert.equal((await runs.get(record.taskId, 'legacy'))?.agentId, undefined);
});

test('损坏的会话归属或状态不会被当作真实快照使用', () => {
  for (const agentId of ['', 1, null]) {
    assert.throws(() => parseTideRunRecord({ ...record, agentId }), /agentId must be a string/);
  }
  for (const sessionState of ['active', true, null]) {
    assert.throws(() => parseTideRunRecord({ ...record, sessionState }), /invalid sessionState/);
  }
});
