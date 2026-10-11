import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileMonsoonSessionRepository, SessionRevisionConflictError } from './session-repository.js';

function session(id = 'session-a') {
  return {
    id, agentId: 'agent-a', agentName: 'A', title: 'New', messages: [], model: 'model-a',
    systemPrompt: '', createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z', revision: 0,
  };
}

test('session repository reads a legacy index without mutating it', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-monsoon-session-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const repository = new FileMonsoonSessionRepository(dataDir);

  const created = await repository.create(session());
  assert.equal(created.revision, 1);
  assert.equal(created.messageRevision, 1);
  await fs.writeFile(path.join(dataDir, 'agents', 'agent-a', 'sessions', '_index.json'),
    JSON.stringify(['session-a']), 'utf8');

  const listed = await repository.list('agent-a');
  assert.equal(listed[0]?.id, 'session-a');
  assert.equal(listed[0]?.revision, 1);
  const unchanged = JSON.parse(await fs.readFile(
    path.join(dataDir, 'agents', 'agent-a', 'sessions', '_index.json'), 'utf8'));
  assert.deepEqual(unchanged, ['session-a']);
});

test('listing an absent Agent never recreates its deleted directory', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-monsoon-session-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const repository = new FileMonsoonSessionRepository(dataDir);
  const agentDir = path.join(dataDir, 'agents', 'agent-deleted');
  assert.deepEqual(await repository.list('agent-deleted'), []);
  await assert.rejects(fs.access(agentDir), { code: 'ENOENT' });
});

test('session replacement is compare-and-swap and preserves manual title for content writes', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-monsoon-session-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const repository = new FileMonsoonSessionRepository(dataDir);
  const created = await repository.create(session());
  const renamed = await repository.replace({ ...created, title: 'Manual', titleManual: true }, 1, 'rename');
  assert.equal((await repository.titles('agent-a')).get('session-a'), 'Manual');
  assert.equal((await repository.titles('agent-other')).size, 0);
  assert.equal(renamed.messageRevision, 1);
  const saved = await repository.replace({ ...created, messages: [{
    id: 'message-a', role: 'user', content: 'hello', timestamp: '2026-01-01T00:00:01.000Z',
  }] }, 2, 'content');

  assert.equal(saved.title, 'Manual');
  assert.equal(saved.revision, 3);
  assert.equal(saved.messageRevision, 2);
  await assert.rejects(
    repository.replace({ ...saved, title: 'stale' }, 1, 'rename'),
    SessionRevisionConflictError,
  );
});

test('model usage survives stale browser content saves without advancing message revision', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-monsoon-session-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const repository = new FileMonsoonSessionRepository(dataDir);
  const created = await repository.create({ ...session(), tokenUsage: {
    promptTokens: 5, completionTokens: 1, totalTokens: 6,
  } });
  await repository.updateTokenUsage('agent-a', 'session-a', {
    promptTokens: 20, completionTokens: 3, totalTokens: 23,
  });
  const current = await repository.get('agent-a', 'session-a');
  assert.equal(current?.revision, created.revision);
  assert.equal(current?.messageRevision, created.messageRevision);
  assert.equal((await repository.list('agent-a'))[0]?.tokenUsage?.totalTokens, 23);

  const saved = await repository.replace({ ...created, messages: [{
    id: 'user-a', role: 'user', content: 'hello', timestamp: '2026-01-01T00:00:01.000Z',
  }] }, created.revision, 'content');
  assert.equal(saved.tokenUsage?.totalTokens, 23);
  await repository.updateTokenUsage('agent-a', 'session-a', null);
  assert.equal((await repository.get('agent-a', 'session-a'))?.tokenUsage, undefined);
  assert.equal((await repository.list('agent-a'))[0]?.tokenUsage, undefined);
});

test('an old browser without usage cannot erase the first server measurement', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-monsoon-session-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const repository = new FileMonsoonSessionRepository(dataDir);
  const created = await repository.create(session());
  await repository.updateTokenUsage('agent-a', 'session-a', {
    promptTokens: 20, completionTokens: 3, totalTokens: 23,
  });

  const saved = await repository.replace({ ...created, messages: [{
    id: 'user-a', role: 'user', content: 'hello', timestamp: '2026-01-01T00:00:01.000Z',
  }] }, created.revision, 'content');
  assert.equal(saved.tokenUsage?.totalTokens, 23);

  const compacted = await repository.replace({ ...saved, tokenUsage: undefined },
    saved.revision, 'content', { clearTokenUsage: true });
  assert.equal(compacted.tokenUsage, undefined);
});

test('two repository instances cannot both replace the same session revision', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-monsoon-session-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const first = new FileMonsoonSessionRepository(dataDir);
  const second = new FileMonsoonSessionRepository(dataDir);
  const created = await first.create(session());
  const results = await Promise.allSettled([
    first.replace({ ...created, title: 'first' }, 1, 'rename'),
    second.replace({ ...created, title: 'second' }, 1, 'rename'),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected'
    && result.reason instanceof SessionRevisionConflictError).length, 1);
  assert.equal((await first.get('agent-a', 'session-a'))?.revision, 2);
});

test('session deletion removes one session and all owned sidecars without touching siblings', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-monsoon-session-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const repository = new FileMonsoonSessionRepository(dataDir);
  await repository.create(session());
  await repository.create(session('session-b'));
  const dir = path.join(dataDir, 'agents', 'agent-a', 'sessions');
  await fs.writeFile(path.join(dir, 'session-a.taskboard.json'), '{}');
  await fs.mkdir(path.join(dir, 'session-a.attachments'));
  await fs.mkdir(path.join(dir, 'session-a.compactions'));
  await fs.writeFile(path.join(dir, 'session-a.compactions', 'record.json'), '{}');
  await fs.mkdir(path.join(dir, 'session-a.inputs'));
  await fs.mkdir(path.join(dir, 'session-a.team'));
  await fs.mkdir(path.join(dir, 'session-a.runs'));

  assert.equal(await repository.delete('agent-a', 'session-a'), true);
  assert.equal(await repository.get('agent-a', 'session-a'), null);
  assert.ok(await repository.get('agent-a', 'session-b'));
  for (const suffix of ['.taskboard.json', '.attachments', '.inputs', '.team', '.runs', '.compactions']) {
    await assert.rejects(fs.access(path.join(dir, `session-a${suffix}`)));
  }
});
