import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileMonsoonSessionRepository } from './session-repository.js';

const timestamp = '2026-11-01T01:00:00.000Z';
function fixture(id: string) {
  return { id, agentId: 'agent-a', agentName: 'A', title: id, model: 'model-a',
    systemPrompt: 'Large prompt '.repeat(1000), createdAt: timestamp, updatedAt: timestamp,
    messages: [{ id: `${id}-human`, role: 'user', timestamp, content: 'Long history '.repeat(20_000) }] };
}

test('warm lists read no primary history, and usage updates read only their target', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-session-summary-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const repository = new FileMonsoonSessionRepository(dataDir);
  for (let index = 0; index < 6; index++) await repository.create(fixture(`session-${index}`));
  const reads: string[] = [];
  const read = fs.readFile.bind(fs);
  t.mock.method(fs, 'readFile', async (...args: Parameters<typeof fs.readFile>) => {
    const file = String(args[0]);
    if (/session-\d\.json$/.test(file)) reads.push(path.basename(file));
    return read(...args);
  });
  const listed = await repository.list('agent-a');
  assert.equal(listed.length, 6);
  assert.ok(listed.every(session => !session.messages.length && !session.systemPrompt));
  assert.deepEqual(reads, []);
  await repository.updateTokenUsage('agent-a', 'session-2', {
    promptTokens: 123, completionTokens: 4, totalTokens: 127,
  });
  assert.deepEqual(reads, ['session-2.json']);
  reads.length = 0;
  assert.equal((await repository.list('agent-a')).find(session => session.id === 'session-2')?.tokenUsage?.totalTokens, 127);
  assert.deepEqual(reads, []);
  const index = await fs.readFile(path.join(dataDir, 'agents/agent-a/sessions/_index.json'), 'utf8');
  assert.ok(index.length < 20_000, 'index size must not scale with transcript or prompt bytes');
});

test('derived input estimates survive read metadata and reject stale content revisions', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-session-estimate-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const repository = new FileMonsoonSessionRepository(dataDir);
  const session = await repository.create(fixture('session-a'));
  const estimate = { tokens: 123, images: 0, model: session.model, estimatedAt: timestamp,
    contextRevision: session.messageRevision };
  await repository.cacheInputEstimate(session, estimate);
  const getEstimate = async () => (await repository.list('agent-a'))[0] as typeof session & { currentInput?: typeof estimate };
  assert.deepEqual((await getEstimate()).currentInput, estimate);
  const read = await repository.replace({ ...session, lastReadAt: timestamp }, session.revision, 'read');
  assert.deepEqual((await getEstimate()).currentInput, estimate);
  await repository.replace({ ...read, messages: [] }, read.revision, 'content');
  await repository.cacheInputEstimate(session, estimate);
  assert.equal((await getEstimate()).currentInput, undefined, 'late preview cannot repopulate an edited session');
});

test('external changes invalidate one header and corrupt primary files are never hidden by the index', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-session-source-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const repository = new FileMonsoonSessionRepository(dataDir);
  const session = await repository.create(fixture('session-a'));
  const file = path.join(dataDir, 'agents/agent-a/sessions/session-a.json');
  await fs.writeFile(file, JSON.stringify({ ...session, title: 'External title' }));
  assert.equal((await repository.list('agent-a'))[0].title, 'External title');
  await fs.writeFile(file, '{broken');
  await assert.rejects(repository.list('agent-a'), SyntaxError);
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
  await fs.rm(file);
  assert.deepEqual(await repository.list('agent-a'), []);
});
