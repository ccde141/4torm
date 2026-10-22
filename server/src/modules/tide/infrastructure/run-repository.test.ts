import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import { tideRunsDir } from '../../../services/data-paths.js';
import { FileTideRunRepository } from './run-repository.js';
import type { TideRunRecord } from '../domain/run.js';

test('结构损坏的运行记录不会被当作真实结果返回', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-run-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const dir = tideRunsDir(dataDir, 'task-a');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, '2026.json'), JSON.stringify({ status: 'success' }), 'utf8');

  await assert.rejects(
    new FileTideRunRepository(dataDir).list('task-a', 20),
    (error: unknown) => error instanceof FrameworkError
      && error.data.code === 'TIDE_RUN_RECORD_CORRUPT',
  );
});

test('潮汐运行正文按 runId 保存与精确取回，旧记录仍可列出', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-records-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const repository = new FileTideRunRepository(dataDir);
  const base = {
    taskId: 'task-a', timestamp: '2026-09-30T00:00:00.000Z',
    status: 'success' as const, sessionId: 'session-a', answer: '完成',
    rawContent: '完成', toolCalls: [], turns: 1, durationMs: 5,
  };
  await repository.save(base);
  await repository.save({ ...base, runId: 'tide-run-a', answer: '第一轮' });
  await repository.save({ ...base, runId: 'tide-run-b', answer: '第二轮' });
  assert.equal((await repository.get('task-a', 'tide-run-a'))?.answer, '第一轮');
  assert.equal((await repository.get('task-a', 'tide-run-b'))?.answer, '第二轮');
  assert.equal((await repository.list('task-a', 10)).length, 3);
  assert.equal(await repository.get('task-a', 'missing'), null);
});

test('潮汐成功及失败记录均保留混合 JSON 工具参数，非法参数不污染已保存记录', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-typed-args-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const repository = new FileTideRunRepository(dataDir);
  const args = { window: 68422, wait: false, bounds: [0, 0, 100, 100],
    options: { label: '截图', nullable: null } };
  const base: TideRunRecord = {
    taskId: 'task-a', timestamp: '2026-10-21T00:00:00.000Z',
    status: 'success', sessionId: 'session-a', answer: '完成', rawContent: '完成',
    toolCalls: [{ tool: 'mcp:desktop:act', args, result: 'ok' }], turns: 1, durationMs: 5,
  };
  await repository.save({ ...base, runId: 'typed-success' });
  await repository.save({ ...base, runId: 'typed-error', status: 'error', error: '后续请求失败' });
  for (const runId of ['typed-success', 'typed-error']) {
    assert.deepEqual((await repository.get(base.taskId, runId))?.toolCalls[0]?.args, args);
  }
  assert.equal((await repository.get(base.taskId, 'typed-success'))?.status, 'success');
  assert.equal((await repository.get(base.taskId, 'typed-error'))?.status, 'error');
  await assert.rejects(repository.save({ ...base, runId: 'typed-success',
    toolCalls: [{ tool: 'bad', args: { bad: () => 1 }, result: '' }] }), /invalid toolCalls/);
  assert.deepEqual((await repository.get(base.taskId, 'typed-success'))?.toolCalls[0]?.args, args);
  assert.equal((await repository.list(base.taskId, 10)).length, 2);
});
