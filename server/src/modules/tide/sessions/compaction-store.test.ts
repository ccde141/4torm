import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { commitTideCompaction } from './compaction-store.js';
import { readTideSession, writeTideSession } from './session-store.js';
import { tideTaskSessionDir } from './session-paths.js';

async function fixture(t: test.TestContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-compaction-commit-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const task = { id: 'task', name: '日报' };
  const original = { id: 'session', agentId: 'agent', agentName: 'A', title: '日报', model: 'model',
    systemPrompt: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    messages: [{ id: 'raw', role: 'user', content: '原始内容' }] };
  await writeTideSession(directory, original, task.id, task.name);
  const next = { ...original, messages: [...original.messages,
    { id: 'marker', role: 'system', content: '完整摘要', type: 'compact-marker' as const }] };
  return { directory, task, original, next,
    dir: tideTaskSessionDir(directory, original.agentId, task.id, task.name) };
}

test('abort after temporary body write never replaces Tide primary; temporary body is cleaned', async t => {
  const fixtureData = await fixture(t);
  const { directory, task, original, next, dir } = fixtureData;
  const controller = new AbortController();
  const write = fs.writeFile.bind(fs);
  t.mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
    const result = await write(...args);
    if (String(args[0]).includes('session.json.') && String(args[0]).endsWith('.tmp')) controller.abort();
    return result;
  });
  await assert.rejects(commitTideCompaction(directory, task, original, next, controller.signal),
    { name: 'AbortError' });
  assert.deepEqual(await readTideSession(directory, original.agentId, original.id, task), original);
  assert.equal((await fs.readdir(dir)).some(file => file.endsWith('.tmp')), false);
});

test('index preparation failure precedes context replacement and stale content cannot overwrite newer turns', async t => {
  const { directory, task, original, next, dir } = await fixture(t);
  await fs.rm(path.join(dir, '_index.json'));
  await fs.mkdir(path.join(dir, '_index.json'));
  await assert.rejects(commitTideCompaction(directory, task, original, next));
  assert.deepEqual(await readTideSession(directory, original.agentId, original.id, task), original);
  await fs.rm(path.join(dir, '_index.json'), { recursive: true });
  const newer = { ...original, messages: [...original.messages, { id: 'new', role: 'user', content: '新内容' }] };
  await writeTideSession(directory, newer, task.id, task.name);
  await assert.rejects(commitTideCompaction(directory, task, original, next), /会话已发生变化/);
  assert.deepEqual(await readTideSession(directory, original.agentId, original.id, task), newer);
});
