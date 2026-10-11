import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import { createTideFeature } from '../api/factory.js';
import { resolveTarget, resolveTargetSessionId, saveTurn } from './session-resolver.js';
import { readTideSession, writeTideSession, type TideSession } from './session-store.js';
import { tideTaskSessionDir } from './session-paths.js';
import type { TideTask } from '../domain/task.js';

async function fixture(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-identity-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const feature = createTideFeature({ dataDir });
  const input = { name: '巡检', schedule: 'every 1h', prompt: '检查', agentId: 'worker', windowN: 6 };
  const first = await feature.tasks.create(input, { enabled: false });
  const second = await feature.tasks.create(input, { enabled: false });
  assert.equal(first.id.slice(0, 8), second.id.slice(0, 8));
  return { dataDir, feature, first, second };
}

function session(task: TideTask, id: string, content: string): TideSession {
  return { id, agentId: task.agentId, agentName: 'Worker', title: content, model: 'test:model',
    systemPrompt: '', createdAt: task.createdAt, updatedAt: task.createdAt,
    messages: [{ id: content, role: 'assistant', content }] };
}

function ambiguous(error: unknown): boolean {
  return error instanceof FrameworkError && error.data.code === 'TIDE_SESSION_AMBIGUOUS';
}

test('new accumulate IDs keep the full task identity for same-prefix tasks', async t => {
  const { first, second } = await fixture(t);
  assert.notEqual(resolveTargetSessionId(first), resolveTargetSessionId(second));
  assert.ok(resolveTargetSessionId(first).includes(first.id));
});

test('bound legacy session IDs read and append only the owning task history', async t => {
  const { dataDir, first, second } = await fixture(t);
  const id = `worker-tide-${first.id.slice(0, 8)}-acc`;
  first.targetSessionId = second.targetSessionId = id;
  await writeTideSession(dataDir, session(first, id, 'private-A'), first.id, first.name);
  await writeTideSession(dataDir, session(second, id, 'private-B'), second.id, second.name);
  const resolved = await resolveTarget(dataDir, second);
  assert.equal(resolved.sessionId, id);
  assert.deepEqual(resolved.history.map(message => message.content), ['private-B']);
  await saveTurn(dataDir, second, resolved, 'Worker', 'test:model', '', 'next-B', 'answer');
  const read = async (task: TideTask) => JSON.parse(await fs.readFile(
    path.join(tideTaskSessionDir(dataDir, task.agentId, task.id, task.name), `${id}.json`), 'utf8')) as TideSession;
  assert.deepEqual((await read(second)).messages.map(message => message.content), ['private-B', 'next-B', 'answer']);
  assert.deepEqual((await read(first)).messages.map(message => message.content), ['private-A']);
  await assert.rejects(readTideSession(dataDir, second.agentId, id), ambiguous);
});

test('a missing task target must never recover another task active or archived history', async t => {
  const { dataDir, first, second } = await fixture(t);
  const id = 'legacy-shared';
  first.targetSessionId = second.targetSessionId = id;
  await writeTideSession(dataDir, session(first, id, 'private-A'), first.id, first.name);
  assert.equal((await resolveTarget(dataDir, second)).existing, null);
  const dir = tideTaskSessionDir(dataDir, first.agentId, first.id, first.name);
  await fs.mkdir(path.join(dir, 'bak'), { recursive: true });
  await fs.rename(path.join(dir, `${id}.json`), path.join(dir, 'bak', `${id}_round.json.bak.1`));
  assert.equal((await resolveTarget(dataDir, second)).existing, null);
});

test('legacy flat files with multiple possible owners are rejected before migration', async t => {
  const { dataDir, feature, first, second } = await fixture(t);
  const id = `worker-tide-${first.id.slice(0, 8)}-acc`;
  first.targetSessionId = second.targetSessionId = id;
  await feature.tasks.update(first.id, { targetSessionId: id });
  await feature.tasks.update(second.id, { targetSessionId: id });
  const root = path.dirname(tideTaskSessionDir(dataDir, first.agentId, first.id, first.name));
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, `${id}.json`);
  await fs.writeFile(file, JSON.stringify(session(first, id, 'uncertain-owner')));
  await assert.rejects(resolveTarget(dataDir, second), ambiguous);
  await assert.rejects(readTideSession(dataDir, second.agentId, id), ambiguous);
  assert.equal((JSON.parse(await fs.readFile(file, 'utf8')) as TideSession).title, 'uncertain-owner');
});

test('a uniquely owned legacy flat session retains its saved ID and history after migration', async t => {
  const { dataDir, feature, first, second } = await fixture(t);
  await feature.tasks.remove(second.id);
  const id = `worker-tide-${first.id.slice(0, 8)}-acc`;
  first.targetSessionId = id;
  await feature.tasks.update(first.id, { targetSessionId: id });
  const root = path.dirname(tideTaskSessionDir(dataDir, first.agentId, first.id, first.name));
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, `${id}.json`), JSON.stringify(session(first, id, 'own-history')));
  const resolved = await resolveTarget(dataDir, first);
  assert.equal(resolved.sessionId, id);
  assert.deepEqual(resolved.history.map(message => message.content), ['own-history']);
  assert.equal((await readTideSession(dataDir, first.agentId, id))?.title, 'own-history');
});

test('duplicate archived legacy IDs remain task-scoped and unscoped reads reject ambiguity', async t => {
  const { dataDir, first, second } = await fixture(t);
  const id = 'legacy-shared';
  for (const [task, content] of [[first, 'private-A'], [second, 'private-B']] as const) {
    task.targetSessionId = id;
    const dir = tideTaskSessionDir(dataDir, task.agentId, task.id, task.name);
    await fs.mkdir(path.join(dir, 'bak'), { recursive: true });
    await fs.writeFile(path.join(dir, 'bak', `${id}_round.json.bak.1`), JSON.stringify(session(task, id, content)));
  }
  assert.equal((await resolveTarget(dataDir, second)).existing?.title, 'private-B');
  await assert.rejects(readTideSession(dataDir, second.agentId, id), ambiguous);
});

test('N=1 preserves the owning title and usage while archiving its own history', async t => {
  const { dataDir, first, second } = await fixture(t);
  const id = 'legacy-shared';
  second.windowN = 1;
  first.targetSessionId = second.targetSessionId = id;
  await writeTideSession(dataDir, { ...session(first, id, 'private-A'), usage: { calls: 1, reportedCalls: 0 } },
    first.id, first.name);
  await writeTideSession(dataDir, { ...session(second, id, 'private-B'), usage: { calls: 3, reportedCalls: 0 } },
    second.id, second.name);
  const resolved = await resolveTarget(dataDir, second);
  assert.deepEqual(resolved.history, []);
  await saveTurn(dataDir, second, resolved, 'Worker', 'test:model', '', 'next-B', 'answer');
  const saved = await readTideSession(dataDir, second.agentId, id, second);
  assert.equal(saved?.title, 'private-B');
  assert.equal(saved?.usage?.calls, 3);
  const dir = path.join(tideTaskSessionDir(dataDir, second.agentId, second.id, second.name), 'bak');
  const [archive] = await fs.readdir(dir);
  const original = JSON.parse(await fs.readFile(path.join(dir, archive), 'utf8')) as TideSession;
  assert.deepEqual(original.messages.map(message => message.content), ['private-B', 'next-B', 'answer']);
});
