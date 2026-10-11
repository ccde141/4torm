import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import { tideRunsDir } from '../../../services/data-paths.js';
import { FileTideRunRepository } from './run-repository.js';

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
