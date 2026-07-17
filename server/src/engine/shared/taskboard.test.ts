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

  execTaskBoard(target, { action: 'set', goal: '验证写入', tasks: [{ title: '完成', status: 'done' }] });

  assert.equal(readTaskboard(target)?.tasks[0]?.title, '完成');
  assert.equal((await fs.readdir(dir)).some(name => name.endsWith('.tmp')), false);
  await fs.rm(dir, { recursive: true, force: true });
});
