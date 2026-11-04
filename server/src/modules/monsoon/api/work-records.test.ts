import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMonsoonFeature } from './factory.js';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import type { CollaborationContext } from '../../../engine/collaboration/contracts.js';
import { monsoonRecallSources } from '../runtime/recall-adapter.js';
import { executeRecallTool } from '../../../engine/shared/memory-recall/read-tools.js';

const context: CollaborationContext = { actor: { type: 'human', id: 'fixture', actingAs: 'human' }, audience: 'human',
  enabledFeatures: new Set(['monsoon']), permissions: new Set(['observe']), requestId: 'work-record-fixture' };

async function fixture(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-work-records-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataDir, 'agents'));
  await fs.writeFile(path.join(dataDir, 'agents/registry.json'), JSON.stringify({ a: { id: 'a', name: 'A' }, b: { id: 'b', name: 'B' } }));
  const feature = createMonsoonFeature({ dataDir });
  const router = new CollaborationRouter([feature.module]);
  const invoke = <T = unknown>(method: string, input: unknown, actor = context) => router.invoke({ feature: 'monsoon', method, input }, actor) as Promise<T>;
  const create = (id: string, timestamp = '2026-11-01T00:00:00Z') => feature.sessions.create({
    id, agentId: 'a', agentName: 'A', title: id, model: 'fixture:unused', systemPrompt: '',
    createdAt: timestamp, updatedAt: timestamp, messages: [
      { id: 'human', role: 'user', content: 'ORIGINAL_EVIDENCE '.repeat(900), timestamp },
      { id: 'marker', role: 'system', type: 'compact-marker', content: '## 当前目标\nOLD_RULE_A\n## 下一步\n继续核验。', timestamp },
    ],
  });
  return { dataDir, feature, invoke, create };
}
interface Page { items: Array<{ id: string; revision: string; sessionId: string; summary: string }>; nextCursor?: string; total: number }

test('timeline and Agent tools read the same successful compaction records with bounded fragments', async t => {
  const { dataDir, invoke, create } = await fixture(t);
  await create('session-a');
  const page = await invoke<Page>('listWorkRecords', { agentId: 'a' });
  assert.equal(page.total, 1);
  assert.equal('content' in page.items[0], false);
  const record = page.items[0];
  const fragment = await invoke<{ content: string }>('readWorkRecord', { agentId: 'a', id: record.id, revision: record.revision });
  const agent = JSON.parse(await executeRecallTool(dataDir, 'a', monsoonRecallSources(dataDir), 'recall_read', { id: record.id }));
  assert.equal(fragment.content, agent.content);
  const original = await invoke<{ content: string; total: number; hasMore: boolean }>('readWorkRecord', {
    agentId: 'a', id: record.id, revision: record.revision, view: 'source', limit: 100,
  });
  assert.equal(original.content.length, 100); assert.ok(original.hasMore);
  assert.match(original.content, /ORIGINAL_EVIDENCE/);
  assert.deepEqual((await invoke<Page>('listWorkRecords', { agentId: 'b' })).items, []);
  await assert.rejects(invoke('readWorkRecord', { agentId: 'b', id: record.id, revision: record.revision }),
    (error: unknown) => (error as { data: { code: string } }).data.code === 'WORK_RECORD_UNAVAILABLE');
});

test('timeline uses chronological keyset pagination, filters, and owner-bound cursors', async t => {
  const { invoke, create } = await fixture(t);
  await create('earlier', '2026-11-01T08:30:00+08:00');
  await create('later', '2026-11-01T01:00:00Z');
  const first = await invoke<Page>('listWorkRecords', { agentId: 'a', limit: 1 });
  assert.equal(first.items[0].sessionId, 'later'); assert.ok(first.nextCursor);
  await create('newest', '2026-11-02T00:00:00Z');
  const second = await invoke<Page>('listWorkRecords', { agentId: 'a', limit: 1, cursor: first.nextCursor });
  assert.equal(second.items[0].sessionId, 'earlier');
  assert.equal((await invoke<Page>('listWorkRecords', { agentId: 'a', query: 'earlier' })).total, 1);
  assert.equal((await invoke<Page>('listWorkRecords', { agentId: 'a', date: '2026-11-02' })).total, 1);
  await assert.rejects(invoke('listWorkRecords', { agentId: 'b', cursor: first.nextCursor }));
  for (const input of [{ agentId: '../a' }, { agentId: 'a', date: '2026-02-31' }, { agentId: 'a', limit: 1000 }]) {
    await assert.rejects(invoke('listWorkRecords', input));
  }
});

test('edits invalidate open fragments, deletion retires sources, and absent Agents are not recreated', async t => {
  const { dataDir, feature, invoke, create } = await fixture(t);
  const session = await create('editable');
  const old = (await invoke<Page>('listWorkRecords', { agentId: 'a' })).items[0];
  await feature.sessions.replace({ ...session, messages: session.messages.map(message => message.id === 'human'
    ? { ...message, content: 'NEW_RULE_B' } : message) }, session.revision, 'content');
  await assert.rejects(invoke('readWorkRecord', { agentId: 'a', id: old.id, revision: old.revision }),
    (error: unknown) => (error as { data: { code: string } }).data.code === 'WORK_RECORD_CHANGED');
  const fresh = (await invoke<Page>('listWorkRecords', { agentId: 'a' })).items[0];
  assert.equal(fresh.id, old.id); assert.notEqual(fresh.revision, old.revision);
  assert.match(fresh.summary, /NEW_RULE_B/); assert.doesNotMatch(fresh.summary, /OLD_RULE_A/);
  await feature.sessions.delete('a', 'editable');
  assert.equal((await invoke<Page>('listWorkRecords', { agentId: 'a' })).total, 0);
  await assert.rejects(invoke('readWorkRecord', { agentId: 'a', id: fresh.id, revision: fresh.revision }));
  await assert.rejects(invoke('listWorkRecords', { agentId: 'missing' }));
  await assert.rejects(fs.access(path.join(dataDir, 'agents/missing')), { code: 'ENOENT' });
});

test('work record human methods stay behind observe admission and are not exposed as Agent tools', async t => {
  const { invoke } = await fixture(t);
  await assert.rejects(invoke('listWorkRecords', { agentId: 'a' }, { ...context, permissions: new Set() }));
  await assert.rejects(invoke('listWorkRecords', { agentId: 'a' }, { ...context, audience: 'agent',
    actor: { type: 'agent', id: 'a', actingAs: 'agent' } }));
});
