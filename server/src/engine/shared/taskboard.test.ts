import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execTaskBoard, readTaskboard, taskboardTempFile } from './taskboard.js';

test('任务板每次写入使用唯一临时文件名', () => {
  const target = 'C:\\data\\session.taskboard.json';
  const first = taskboardTempFile(target);
  const second = taskboardTempFile(target);

  assert.notEqual(first, second);
  assert.match(first, /session\.taskboard\.json\.\d+\.[0-9a-f-]+\.tmp$/i);
  assert.match(second, /session\.taskboard\.json\.\d+\.[0-9a-f-]+\.tmp$/i);
});

test('任务板写入完成后不残留临时文件', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-taskboard-'));
  const target = path.join(dir, 'session.taskboard.json');

  await execTaskBoard(target, { action: 'set', goal: '验证写入', tasks: [{ title: '完成', status: 'done' }] });

  assert.equal(readTaskboard(target)?.tasks[0]?.title, '完成');
  assert.equal((await fs.readdir(dir)).some(name => name.endsWith('.tmp')), false);
  await fs.rm(dir, { recursive: true, force: true });
});

test('任务板只接受基于当前 revision 的覆盖写入', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-taskboard-revision-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'session.taskboard.json');

  const created = await execTaskBoard(target, {
    action: 'set', expectedRevision: 0, goal: '交付',
    tasks: [{ title: '第一版', status: 'doing' }],
  });
  assert.equal(created.meta?.taskboard?.revision, 1);

  const updated = await execTaskBoard(target, {
    action: 'set', expectedRevision: 1, goal: '交付',
    tasks: [{ title: '第二版', status: 'done' }],
  });
  assert.equal(updated.meta?.taskboard?.revision, 2);
  assert.match((await execTaskBoard(target, { action: 'get' })).result, /revision=2/);

  const stale = await execTaskBoard(target, {
    action: 'set', expectedRevision: 1, goal: '交付',
    tasks: [{ title: '过期覆盖', status: 'doing' }],
  });
  assert.match(stale.result, /版本冲突/);
  assert.equal(stale.meta?.taskboard?.revision, 2);
  assert.equal(readTaskboard(target)?.tasks[0]?.title, '第二版');
});

test('任务板兼容模型工具调用传入的十进制字符串 revision', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-taskboard-string-revision-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'session.taskboard.json');

  const created = await execTaskBoard(target, {
    action: 'set', expectedRevision: '0', goal: '模型调用',
    tasks: '[{"title":"第一步","status":"doing"}]',
  });
  assert.equal(created.conflict, undefined);
  assert.equal(created.meta?.taskboard?.revision, 1);

  const updated = await execTaskBoard(target, {
    action: 'set', expectedRevision: '1', goal: '模型调用',
    tasks: '[{"title":"第一步","status":"done"}]',
  });
  assert.equal(updated.conflict, undefined);
  assert.equal(updated.meta?.taskboard?.revision, 2);

  const ambiguous = await execTaskBoard(target, {
    action: 'set', expectedRevision: '01', goal: '模型调用',
    tasks: '[{"title":"不应写入","status":"done"}]',
  });
  assert.equal(ambiguous.conflict, true);
  assert.equal(readTaskboard(target)?.revision, 2);
});

test('并发更新同一 revision 时只有一个写入成功', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-taskboard-cas-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'session.taskboard.json');
  await execTaskBoard(target, {
    action: 'set', expectedRevision: 0, goal: '并发',
    tasks: [{ title: '初始', status: 'todo' }],
  });

  const results = await Promise.all([
    execTaskBoard(target, {
      action: 'set', expectedRevision: 1, goal: '并发',
      tasks: [{ title: '更新 A', status: 'doing' }],
    }),
    execTaskBoard(target, {
      action: 'set', expectedRevision: 1, goal: '并发',
      tasks: [{ title: '更新 B', status: 'doing' }],
    }),
  ]);

  assert.equal(results.filter(result => /已更新/.test(result.result)).length, 1);
  assert.equal(results.filter(result => /版本冲突/.test(result.result)).length, 1);
  assert.equal(readTaskboard(target)?.revision, 2);
});
