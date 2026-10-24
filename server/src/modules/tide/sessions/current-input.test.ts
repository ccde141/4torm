import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { agentRegistryFile } from '../../../services/data-paths.js';
import { observeModelRequests } from '../../../engine/shared/model-request-usage.js';
import { createMonsoonExternalSessionPort } from '../../monsoon/public.js';
import { FileMonsoonSessionRepository } from '../../monsoon/infrastructure/session-repository.js';
import { createTideFeature } from '../api/factory.js';
import { FileTideTaskRepository } from '../infrastructure/task-repository.js';
import { currentTideInput } from './current-input.js';
import { writeTideSession } from './session-store.js';
import type { TideSession } from './session-types.js';

async function fixture(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-input-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'fixture', baseUrl: 'https://fixture.invalid/v1', models: ['demo'],
  }] }));
  const registry = agentRegistryFile(dataDir);
  await fs.mkdir(path.dirname(registry), { recursive: true });
  await fs.writeFile(registry, JSON.stringify({ worker: { name: 'Worker', model: 'fixture:demo',
    config: { tools: ['read_file'], toolMode: 'selected', skills: [] } } }));
  const session: TideSession = { id: 'session-input', agentId: 'worker', agentName: 'Worker',
    title: 'Input', model: 'fixture:demo', systemPrompt: 'Stored instructions',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [
      { id: 'u', role: 'user', content: 'Original project evidence '.repeat(3000) },
      { id: 'a', role: 'assistant', content: 'Completed analysis '.repeat(1500) },
    ], tokenUsage: { promptTokens: 70000, completionTokens: 300, totalTokens: 70300 } };
  return { dataDir, session };
}

test('Tide current input follows edits, deletion and effective compaction without network or billing', async t => {
  const { dataDir, session } = await fixture(t);
  const requests: unknown[] = [];
  const previous = globalThis.fetch;
  let network = 0;
  globalThis.fetch = async () => { network++; throw new Error('No network allowed'); };
  t.after(() => { globalThis.fetch = previous; });
  const original = structuredClone(session);
  await observeModelRequests(event => requests.push(event), async () => {
    const full = await currentTideInput(dataDir, session);
    const edited = structuredClone(session);
    edited.messages[0].content = 'Edited task';
    const afterEdit = await currentTideInput(dataDir, edited);
    edited.messages.splice(1, 1);
    const afterDelete = await currentTideInput(dataDir, edited);
    const compacted = structuredClone(session);
    compacted.messages.push({ id: 'compact', role: 'system', content: 'Summary', type: 'compact-marker',
      nativeContext: [{ role: 'system', content: 'Concise project summary' },
        { role: 'user', content: 'Retained recent task' }] });
    const afterCompact = await currentTideInput(dataDir, compacted);
    assert.equal(full?.basis, 'compiled');
    assert.ok(full!.tokens > afterEdit!.tokens);
    assert.ok(afterEdit!.tokens > afterDelete!.tokens);
    assert.ok(full!.tokens > afterCompact!.tokens);
    assert.deepEqual(session, original);
    assert.deepEqual(compacted.tokenUsage, original.tokenUsage);
    const emptied = await currentTideInput(dataDir, { ...session, messages: [] });
    assert.ok(emptied.tokens > 0 && emptied.tokens < full!.tokens);
  });
  assert.equal(network, 0);
  assert.deepEqual(requests, []);
});

test('Tide task detail and session reads expose the active estimate and preserve historical bills', async t => {
  const { dataDir, session } = await fixture(t);
  let executions = 0;
  const feature = createTideFeature({ dataDir, execute: async () => { executions++; throw new Error('Must not execute'); } });
  const task = { id: 'task-input', name: 'Input', agentId: 'worker', schedule: 'every 5m',
    prompt: 'Future prompt should not be appended '.repeat(1000), repeatCount: -1,
    pushMode: 'accumulate' as const, targetSessionId: session.id, windowN: 2,
    selfLoop: false, consecutiveErrors: 0, enabled: false, createdAt: session.createdAt };
  await new FileTideTaskRepository(dataDir).upsert(task);
  await writeTideSession(dataDir, session, task.id, task.name);
  const expected = await currentTideInput(dataDir, session, task);
  const detail = await feature.tasks.detail(task.id);
  const read = await feature.tasks.readSession('worker', session.id);
  assert.equal(detail.task.currentInput?.tokens, expected?.tokens);
  assert.equal(read.currentInput?.tokens, expected?.tokens);
  assert.deepEqual(read.tokenUsage, session.tokenUsage);
  session.messages = [{ id: 'short', role: 'user', content: 'Shortened task' }];
  await writeTideSession(dataDir, session, task.id, task.name);
  const updated = await feature.tasks.detail(task.id);
  assert.ok(updated.task.currentInput!.tokens < detail.task.currentInput!.tokens);
  assert.equal(Object.hasOwn((await new FileTideTaskRepository(dataDir).get(task.id))!, 'currentInput'), false);
  assert.equal(executions, 0);
});

test('designated Tide estimates use the owning Monsoon active context with the actual Tide execution prompt', async t => {
  const { dataDir, session } = await fixture(t);
  const sessions = new FileMonsoonSessionRepository(dataDir);
  const common = { ...session, revision: 1, messageRevision: 1, messages: [] };
  await sessions.create({ ...common, messages: [
    { id: 'archived', role: 'user', content: 'Archived evidence '.repeat(5000), timestamp: session.createdAt },
    { id: 'marker', role: 'system', content: 'Concise summary', type: 'compact-marker', timestamp: session.createdAt },
    { id: 'tail', role: 'assistant', content: 'Recent answer', timestamp: session.createdAt },
  ] });
  const port = createMonsoonExternalSessionPort(dataDir);
  const stored = await port.read('worker', session.id);
  assert.ok(stored);
  const task = { id: 'task-designated', name: 'Designated', agentId: 'worker', schedule: 'every 5m',
    prompt: 'Scheduled work', repeatCount: -1, pushMode: 'designated' as const,
    targetSessionId: session.id, windowN: 1, selfLoop: false,
    consecutiveErrors: 0, enabled: false, createdAt: session.createdAt };
  const preview = await currentTideInput(dataDir, stored, task, port);
  const active = await port.activeContext(stored);
  const projected: TideSession = { ...session, messages: active.map((message, index) => ({
    id: `active-${index}`, role: message.role, content: message.content,
  })) };
  const expected = await currentTideInput(dataDir, projected, { ...task, pushMode: 'accumulate' });
  assert.equal(preview?.tokens, expected?.tokens);
  const original = await port.read('worker', session.id);
  assert.equal(original?.messages.length, 3);
  assert.equal(original?.revision, stored.revision);
});
