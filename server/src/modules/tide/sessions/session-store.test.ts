import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import {
  deleteTideSession,
  listTideSessions,
  readTideSession,
  writeTideSession,
  type TideSession,
} from './session-store.js';
import { migrateOldTideSessions } from './session-migration.js';
import { tideTaskDirName } from './session-paths.js';

function session(): TideSession {
  return {
    id: 'session-a', agentId: 'agent-a', agentName: 'Agent A', title: 'test',
    messages: [], model: 'test-model', systemPrompt: 'test',
    createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z',
  };
}

test('损坏的潮汐会话会被隔离并真实抛错', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-session-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await writeTideSession(dataDir, session(), 'tide-task-a', 'task');
  const root = path.join(dataDir, 'agents', 'agent-a', 'sessions-tide');
  const [taskDir] = await fs.readdir(root);
  const file = path.join(root, taskDir, 'session-a.json');
  await fs.writeFile(file, '{broken', 'utf8');

  await assert.rejects(
    readTideSession(dataDir, 'agent-a', 'session-a'),
    (error: unknown) => error instanceof FrameworkError
      && error.data.code === 'TIDE_SESSION_CORRUPT',
  );
  const files = await fs.readdir(path.join(root, taskDir));
  assert.ok(files.some(name => name.startsWith('session-a.json.corrupt-')));
});

test('删除不存在的潮汐会话返回 false', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-session-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const deleted = await deleteTideSession(
    dataDir, 'agent-a', 'missing-session', 'tide-task-a', 'task',
  );
  assert.equal(deleted, false);
});

test('任务改名不改变会话目录，同一任务的旧目录能无损合并', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-rename-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const taskId = 'tide-task-a';
  assert.equal(tideTaskDirName('旧名', taskId), tideTaskDirName('新名', taskId));

  const root = path.join(dataDir, 'agents', 'agent-a', 'sessions-tide');
  const old = path.join(root, '旧名_task-a');
  const renamed = path.join(root, '新名_task-a');
  await fs.mkdir(path.join(old, 'bak'), { recursive: true });
  await fs.mkdir(path.join(renamed, 'bak'), { recursive: true });
  const first = { ...session(), messages: [{ id: 'old', role: 'assistant', content: '旧轮', timestamp: '2026-09-29T00:00:00.000Z' }] };
  const latest = { ...session(), updatedAt: '2026-09-30T00:00:00.000Z', messages: [{ id: 'new', role: 'assistant', content: '新轮' }] };
  await fs.writeFile(path.join(old, 'session-a.json'), JSON.stringify(first));
  await fs.writeFile(path.join(old, '_index.json'), '["session-a"]');
  await fs.writeFile(path.join(old, 'bak', 'round.bak.1'), JSON.stringify(first));
  await fs.writeFile(path.join(renamed, 'session-a.json'), JSON.stringify(latest));
  await fs.writeFile(path.join(renamed, '_index.json'), '["session-a"]');
  await fs.writeFile(path.join(renamed, 'bak', 'round.bak.2'), JSON.stringify(latest));

  await migrateOldTideSessions(dataDir, 'agent-a', taskId, '新名');
  const sessions = await listTideSessions(dataDir, 'agent-a');
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].messages[0].content, '新轮');
  const dirs = await fs.readdir(root);
  assert.equal(dirs.length, 1);
  assert.deepEqual(await fs.readdir(path.join(root, dirs[0], 'bak')), ['round.bak.1', 'round.bak.2']);
});
