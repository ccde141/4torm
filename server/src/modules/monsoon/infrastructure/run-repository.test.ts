import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { FileMonsoonRunRepository } from './run-repository.js';

async function setup(t: TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-monsoon-runs-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  return { dataDir, repository: new FileMonsoonRunRepository(dataDir) };
}

test('stores only bounded run metadata and replaces the latest session run', async (t) => {
  const { dataDir, repository } = await setup(t);
  await repository.save({ schemaVersion: 1, sessionId: 'session/a', runId: 'run-1',
    agentId: 'agent-a', status: 'running', phase: 'streaming', updatedAt: '2026-09-30T01:00:00.000Z' });
  await repository.save({ schemaVersion: 1, sessionId: 'session/a', runId: 'run-2',
    agentId: 'agent-a', status: 'completed', phase: 'completed', updatedAt: '2026-09-30T01:01:00.000Z' });
  assert.deepEqual(await repository.load(), [{ schemaVersion: 1, sessionId: 'session/a',
    runId: 'run-2', agentId: 'agent-a', status: 'completed', phase: 'completed',
    updatedAt: '2026-09-30T01:01:00.000Z', createdAt: '2026-09-30T01:01:00.000Z' }]);
  const serialized = JSON.stringify(await fs.readdir(path.join(dataDir, 'monsoon', 'runs')));
  assert.equal(serialized.includes('session/a'), false);
  assert.deepEqual((await repository.history()).map(record => record.runId), ['run-1', 'run-2']);
  assert.equal((await repository.getRun('session/a', 'run-1'))?.status, 'running');
});

test('旧轮次重启时标记 crashed 不会盖过较新的会话运行', async t => {
  const { dataDir, repository } = await setup(t);
  await repository.save({ schemaVersion: 1, sessionId: 'session-a', runId: 'run-old',
    agentId: 'agent-a', status: 'running', phase: 'streaming',
    updatedAt: '2026-09-30T00:00:00.000Z' });
  await repository.save({ schemaVersion: 1, sessionId: 'session-a', runId: 'run-new',
    agentId: 'agent-a', status: 'completed', phase: 'completed',
    updatedAt: '2026-09-30T01:00:00.000Z' });
  assert.equal((await repository.recover('2026-09-30T02:00:00.000Z')).crashed, 1);
  const reloaded = new FileMonsoonRunRepository(dataDir);
  assert.equal((await reloaded.load())[0]?.runId, 'run-new');
  assert.equal((await reloaded.getRun('session-a', 'run-old'))?.status, 'crashed');
});

test('旧版季风单文件运行事实恢复一次后可按旧句柄读取', async t => {
  const { dataDir, repository } = await setup(t);
  const dir = path.join(dataDir, 'monsoon', 'runs');
  await fs.mkdir(dir, { recursive: true });
  const name = createHash('sha256').update('session-a').digest('hex');
  await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify({
    schemaVersion: 1, sessionId: 'session-a', runId: 'run-old', agentId: 'agent-a',
    status: 'running', phase: 'streaming', updatedAt: '2026-09-30T00:00:00.000Z',
  }));
  assert.equal((await repository.recover('2026-09-30T01:00:00.000Z')).crashed, 1);
  assert.equal((await new FileMonsoonRunRepository(dataDir)
    .recover('2026-09-30T02:00:00.000Z')).crashed, 0);
  assert.equal((await repository.getRun('session-a', 'run-old'))?.status, 'crashed');
});

test('startup recovery turns unrecoverable active states into crashed', async (t) => {
  const { repository } = await setup(t);
  await repository.save({ schemaVersion: 1, sessionId: 's1', runId: 'r1', agentId: 'a1',
    status: 'running', phase: 'streaming', updatedAt: '2026-09-30T01:00:00.000Z' });
  const recovered = await repository.recover('2026-09-30T02:00:00.000Z');
  assert.equal(recovered.crashed, 1);
  assert.deepEqual(recovered.records.map(record => [record.status, record.errorCode]),
    [['crashed', 'MONSOON_PROCESS_RESTARTED']]);
  assert.deepEqual((await repository.recover('2026-09-30T03:00:00.000Z')).records,
    recovered.records);
});

test('corrupt records fail truthfully instead of disappearing', async (t) => {
  const { dataDir, repository } = await setup(t);
  const dir = path.join(dataDir, 'monsoon', 'runs');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'broken.json'), '{bad', 'utf8');
  await assert.rejects(repository.load(), (error: any) =>
    error?.data?.code === 'MONSOON_RUN_RECORD_CORRUPT');
});
