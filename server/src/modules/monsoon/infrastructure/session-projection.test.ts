import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { FileMonsoonSessionRepository } from './session-repository.js';

function session(id = 'session-a') {
  return { id, agentId: 'agent-a', agentName: 'A', title: id, messages: [], model: 'model-a',
    systemPrompt: '', createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z', revision: 0 };
}

async function fixture(t: TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-monsoon-projection-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const dir = path.join(dataDir, 'agents', 'agent-a', 'sessions');
  await fs.mkdir(dir, { recursive: true });
  return { dataDir, dir, indexFile: path.join(dir, '_index.json'),
    repository: new FileMonsoonSessionRepository(dataDir) };
}

test('failed index commit leaves a discoverable primary after the IO fault is removed', async t => {
  const { dataDir, dir, indexFile, repository } = await fixture(t);
  await fs.mkdir(indexFile);
  await assert.rejects(repository.create(session()));
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'session-a.json'), 'utf8')).id,
    'session-a');
  await assert.rejects(repository.list('agent-a'));
  await assert.rejects(repository.titles('agent-a'));
  await fs.rm(indexFile, { recursive: true });
  const reopened = new FileMonsoonSessionRepository(dataDir);
  assert.deepEqual((await reopened.list('agent-a')).map(item => item.id), ['session-a']);
  assert.equal((await reopened.titles('agent-a')).get('session-a'), 'session-a');
  assert.equal(JSON.parse(await fs.readFile(indexFile, 'utf8'))[0].i, 'session-a');
});

test('title lookup repairs an orphan while preserving valid legacy index entries', async t => {
  const { dataDir, dir, indexFile, repository } = await fixture(t);
  await repository.create(session());
  await fs.writeFile(indexFile, JSON.stringify(['session-a']));
  await fs.writeFile(path.join(dir, 'session-b.json'), JSON.stringify(session('session-b')));
  const reopened = new FileMonsoonSessionRepository(dataDir);
  assert.equal((await reopened.titles('agent-a')).get('session-b'), 'session-b');
  const index = JSON.parse(await fs.readFile(indexFile, 'utf8'));
  assert.equal(index[0], 'session-a');
  assert.equal(index[1].i, 'session-b');
});

test('a corrupt or invalid index remains a visible error and is never overwritten', async t => {
  const { dir, indexFile, repository } = await fixture(t);
  await fs.writeFile(path.join(dir, 'session-a.json'), JSON.stringify(session()));
  for (const invalid of ['{broken', '{}', '[{}]', '["../outside"]',
    '[{"i":"session-a","t":42,"u":"2026-01-01T00:00:00.000Z"}]']) {
    await fs.writeFile(indexFile, invalid);
    await assert.rejects(repository.list('agent-a'));
    await assert.rejects(repository.titles('agent-a'));
    assert.equal(await fs.readFile(indexFile, 'utf8'), invalid);
  }
});

test('projection discovery excludes sidecars and rejects corrupt or mismatched primaries', async t => {
  const { dir, indexFile, repository } = await fixture(t);
  await fs.writeFile(indexFile, '[]');
  await fs.writeFile(path.join(dir, 'session-a.taskboard.json'), '{broken');
  await fs.mkdir(path.join(dir, 'session-a.inputs'));
  await fs.writeFile(path.join(dir, 'session-a.inputs', 'input.json'), '{broken');
  assert.deepEqual(await repository.list('agent-a'), []);
  const primary = path.join(dir, 'session-a.json');
  for (const invalid of ['{broken', JSON.stringify({ ...session(), agentId: 'agent-b' }),
    JSON.stringify(session('wrong-id'))]) {
    await fs.writeFile(primary, invalid);
    await assert.rejects(repository.list('agent-a'));
    assert.equal(await fs.readFile(indexFile, 'utf8'), '[]');
  }
});

test('concurrent recovery and creation cannot overwrite one another across repositories', async t => {
  const { dataDir, dir, repository } = await fixture(t);
  await fs.writeFile(path.join(dir, 'session-a.json'), JSON.stringify(session()));
  const second = new FileMonsoonSessionRepository(dataDir);
  await Promise.all([repository.list('agent-a'), second.create(session('session-b')),
    repository.titles('agent-a')]);
  assert.deepEqual((await second.list('agent-a')).map(item => item.id).sort(),
    ['session-a', 'session-b']);
});
