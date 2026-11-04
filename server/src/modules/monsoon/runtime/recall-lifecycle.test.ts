import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileMonsoonSessionRepository } from '../infrastructure/session-repository.js';
import { syncMonsoonRecallRecords } from '../infrastructure/recall-records.js';
import { monsoonRecallSources } from './recall-adapter.js';
import { MemoryRecallSession, drainRecallWorkers, readRecallSessionState, listWorkRecords } from '../../../engine/shared/memory-recall/index.js';
import { recallStateFile, changeRecallState } from '../../../engine/shared/memory-recall/state.js';
import { recallCard } from '../../../engine/shared/memory-recall/cards.js';
import { RECALL_PREFIX, sanitizeRecallReferences } from '../../../engine/shared/memory-recall/delivery.js';
import { projectMonsoonContext } from '../application/active-context.js';
import type { ContextMessage } from '../../../engine/shared/types.js';
import type { RecallSessionState } from '../../../engine/shared/memory-recall/contracts.js';

async function fixture(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'recall-lifecycle-'));
  t.after(async () => { await drainRecallWorkers(dataDir); await fs.rm(dataDir, { recursive: true, force: true }); });
  await fs.writeFile(path.join(dataDir, 'memory-recall-settings.json'), JSON.stringify({ version: 1, model: null,
    level1Enabled: true, level2Enabled: false }));
  const repository = new FileMonsoonSessionRepository(dataDir), time = '2026-11-01T00:00:00Z';
  const create = (id: string) => repository.create({ id, agentId: 'a', agentName: 'A', title: id,
    model: 'unused:main', systemPrompt: '', createdAt: time, updatedAt: time, messages: [
      { id: 'human', role: 'user', content: 'OLD_RULE_A', timestamp: time },
      { id: 'marker', role: 'system', type: 'compact-marker', content: '旧约定 OLD_RULE_A', timestamp: time },
    ] });
  return { dataDir, repository, create, sources: monsoonRecallSources(dataDir) };
}

test('editing old content invalidates its summary immediately, reindexes current literal content and preserves daily identity', async t => {
  const { dataDir, repository, create, sources } = await fixture(t);
  const original = await create('source'); await syncMonsoonRecallRecords(dataDir, 'a');
  const first = (await listWorkRecords(dataDir, 'a'))[0];
  const document = await sources.read('a', first.id); assert.ok(document);
  const edited = await repository.replace({ ...original, messages: original.messages.map(message =>
    message.id === 'human' ? { ...message, content: 'NEW_RULE_B' } : message) }, original.revision, 'content');
  assert.equal(edited.historyRevision, 1); assert.equal(await sources.read('a', first.id), null);
  assert.doesNotMatch(JSON.stringify(projectMonsoonContext(edited)), /OLD_RULE_A/);
  await syncMonsoonRecallRecords(dataDir, 'a');
  const updated = (await listWorkRecords(dataDir, 'a'))[0];
  assert.equal(updated.id, first.id); assert.equal(updated.sequence, first.sequence); assert.notEqual(updated.revision, first.revision);
  const current = await sources.read('a', updated.id); assert.ok(current);
  assert.match(current.content, /NEW_RULE_B/); assert.doesNotMatch(current.content, /OLD_RULE_A/);
  const historical: ContextMessage[] = [{ role: 'user', origin: 'framework', placement: 'before-human',
    content: RECALL_PREFIX + JSON.stringify({ records: [recallCard(document, document.content, 'L2')] }) }];
  await sanitizeRecallReferences('a', sources, historical); assert.equal(historical[0].content, '');
});

test('normal append keeps source identity; editing the marker itself recalls its new content', async t => {
  const { dataDir, repository, create, sources } = await fixture(t);
  const original = await create('s'); await syncMonsoonRecallRecords(dataDir, 'a');
  const first = (await listWorkRecords(dataDir, 'a'))[0];
  const appended = await repository.replace({ ...original, messages: [...original.messages,
    { id: 'new', role: 'user', content: 'next', timestamp: original.updatedAt }] }, original.revision, 'content');
  assert.equal(appended.historyRevision, 0); assert.ok(await sources.read('a', first.id));
  const edited = await repository.replace({ ...appended, messages: appended.messages.map(message =>
    message.id === 'marker' ? { ...message, content: 'REVISED_SUMMARY' } : message) }, appended.revision, 'content');
  assert.equal(edited.historyRevision, 1); await syncMonsoonRecallRecords(dataDir, 'a');
  assert.equal((await sources.read('a', first.id))?.content, 'REVISED_SUMMARY');
  const renamed = await repository.replace({ ...edited, title: 'Renamed source' }, edited.revision, 'rename');
  assert.equal(renamed.historyRevision, 1); assert.equal(await sources.read('a', first.id), null);
  await syncMonsoonRecallRecords(dataDir, 'a');
  assert.equal((await sources.read('a', first.id))?.title, 'Renamed source');
});

test('editing the owner cancels durable pending work and rejects its late result', async t => {
  const { dataDir, repository, create, sources } = await fixture(t);
  const owner = await create('owner');
  await fs.writeFile(path.join(dataDir, 'memory-recall-settings.json'), JSON.stringify({ version: 1, model: 'fixture:model',
    level1Enabled: false, level2Enabled: true }));
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const scope = { agentId: 'a', sessionId: 'owner' };
  const recall = new MemoryRecallSession(dataDir, scope, sources, async () => {
    entered(); await new Promise<void>(resolve => { release = resolve; }); return { cards: [] };
  });
  await recall.beforeModel([{ role: 'user', origin: 'human', content: 'OLD_RULE_A' }], 'old');
  recall.startPending(); await started;
  const old = await readRecallSessionState(dataDir, scope);
  await repository.replace({ ...owner, messages: owner.messages.map(message => message.id === 'human'
    ? { ...message, content: 'NEW_RULE' } : message) }, owner.revision, 'content');
  release(); await drainRecallWorkers(dataDir);
  const current = await readRecallSessionState(dataDir, scope);
  assert.equal(current?.status, 'cancelled'); assert.notEqual(current?.inputKey, old?.inputKey);
  assert.deepEqual(current?.pending, []); assert.deepEqual(current?.candidates, []);
});

test('deleting an owner while recall runs cannot recreate its state or leak into a sibling session', async t => {
  const { dataDir, repository, create, sources } = await fixture(t);
  await create('owner'); await create('sibling');
  await fs.writeFile(path.join(dataDir, 'memory-recall-settings.json'), JSON.stringify({ version: 1, model: 'fixture:model',
    level1Enabled: false, level2Enabled: true }));
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const session = new MemoryRecallSession(dataDir, { agentId: 'a', sessionId: 'owner' }, sources, async () => {
    entered(); await new Promise<void>(resolve => { release = resolve; }); return { cards: [] };
  });
  await session.beforeModel([{ role: 'user', origin: 'human', content: 'OLD_RULE_A' }], 'run');
  session.startPending(); await started; await repository.delete('a', 'owner'); release(); await drainRecallWorkers(dataDir);
  await assert.rejects(fs.access(recallStateFile(dataDir, { agentId: 'a', sessionId: 'owner' })), { code: 'ENOENT' });
  assert.ok(await repository.get('a', 'sibling')); assert.equal(await repository.get('a', 'owner'), null);
});

test('a crash before context commit releases a reservation; durable delivery is not repeated after restart', async t => {
  const { dataDir, create, sources } = await fixture(t);
  await create('source'); await create('target'); await syncMonsoonRecallRecords(dataDir, 'a');
  const document = await sources.read('a', (await listWorkRecords(dataDir, 'a'))[0].id); assert.ok(document);
  const scope = { agentId: 'a', sessionId: 'target' }, version = await sources.sessionVersion!('a', 'target');
  const configuration = (await new MemoryRecallSession(dataDir, scope, sources).beforeModel([
    { role: 'user', origin: 'human', content: 'seed' }], 'seed'), (await readRecallSessionState(dataDir, scope))!.configuration);
  const card = recallCard(document, document.content, 'L2');
  const state: RecallSessionState = { version: 2, owner: scope, sourceVersion: version!, configuration,
    inputKey: 'old-input', query: 'OLD_RULE_A', status: 'searching', updatedAt: new Date().toISOString(), cards: [card],
    pending: [{ ...card, status: 'staged', preparedFor: 'old-input', preparedAt: new Date().toISOString(), context: [], deliveryId: 'delivery' }],
    deliveries: [{ id: 'delivery', inputKey: 'old-input', status: 'staged', timestamp: new Date().toISOString(), sources: [card] }] };
  await changeRecallState(dataDir, scope, undefined, () => state);
  assert.equal((await readRecallSessionState(dataDir, scope))?.status, 'cancelled');
  const restored = new MemoryRecallSession(dataDir, scope, sources);
  const context: ContextMessage[] = [{ role: 'user', origin: 'human', content: 'OLD_RULE_A' }];
  const delivery = await restored.beforeModel(context, 'recovered'); assert.equal(delivery.messages.length, 1);
  assert.equal(delivery.placement, 'before-human');
  context.push({ role: 'user', origin: 'framework', placement: delivery.placement, content: delivery.messages[0] });
  const reopened = new MemoryRecallSession(dataDir, scope, sources);
  context.push({ role: 'user', origin: 'human', content: '继续' });
  assert.equal((await reopened.beforeModel(context, 'next')).messages.length, 0);
});
