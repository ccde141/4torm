import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerCompactWork, listWorkRecords } from './work-records.js';
import { createRecallCatalog } from './catalog.js';
import { MemoryRecallSession, readRecallSessionState, drainRecallWorkers } from './session.js';
import { loadMemoryRecallSettings, saveMemoryRecallSettings } from './settings.js';
import { writeMemory, deleteMemory } from '../agent-memory.js';
import { executeRecallTool } from './read-tools.js';
import { frameworkError } from '../framework-error.js';
import type { ContextMessage } from '../types.js';
import type { RecallCard } from './contracts.js';
import { MemoryRecallSettingsService } from '../../../modules/runtime-settings/memory-recall-settings.js';

async function fixture(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-recall-pilot-'));
  t.after(async () => { await drainRecallWorkers(dataDir); await fs.rm(dataDir, { recursive: true, force: true }); });
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{ id: 'p',
    baseUrl: 'https://unused.invalid/v1', models: ['recall', 'embed'] }] }));
  await saveMemoryRecallSettings(dataDir, { version: 1, model: 'p:recall', embeddingModel: 'p:embed', enabled: true });
  return dataDir;
}
async function waitForState(dataDir: string, status: string) {
  for (let i = 0; i < 100; i++) {
    const value = await readRecallSessionState(dataDir, { agentId: 'a', sessionId: 's' });
    if (value?.status === status) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`state never became ${status}`);
}
test('daily work numbers are scoped, stable under concurrent retries, and retain session ownership', async t => {
  const dataDir = await fixture(t);
  const source = (id: string, sessionId: string) => ({ id, sessionId, sessionTitle: sessionId,
    timestamp: '2026-10-31T02:00:00Z', summary: '功能岛保持独立' });
  const records = await Promise.all([registerCompactWork(dataDir, 'a', source('one', 'first')),
    registerCompactWork(dataDir, 'a', source('two', 'second')), registerCompactWork(dataDir, 'a', source('one', 'first'))]);
  assert.equal(records[0].id, records[2].id);
  assert.deepEqual((await listWorkRecords(dataDir, 'a')).map(record => record.sequence).sort(), [1, 2]);
  const other = await registerCompactWork(dataDir, 'b', source('one', 'first'));
  assert.equal(other.sequence, 1);
  const catalog = createRecallCatalog(dataDir);
  const result = JSON.parse(await executeRecallTool(dataDir, 'a', catalog, 'recall_search', {
    query: '功能岛', kind: 'work', date: records[0].date, sequence: records[0].sequence }));
  assert.equal(result.records.length, 1); assert.equal(result.records[0].sessionId, 'first');
  assert.equal(await catalog.read('b', records[1].id), null);
  await assert.rejects(executeRecallTool(dataDir, 'a', catalog, 'recall_search', { query: '功能岛', agentId: 'b' }));
});

test('the first human input receives Level 1 memory before model inference without waiting for Level 2', async t => {
  const dataDir = await fixture(t);
  await saveMemoryRecallSettings(dataDir, { version: 1, model: 'p:recall', level1Enabled: true, level2Enabled: true });
  await writeMemory(dataDir, 'a', { summary: '青禾资料站界面偏好', detail: '青禾采用轻玻璃卡片，避免纯黑底块。',
    category: 'feedback', source: 'test', now: new Date().toISOString() });
  let selected = false;
  const session = new MemoryRecallSession(dataDir, { agentId: 'a', sessionId: 's' }, createRecallCatalog(dataDir),
    async () => { selected = true; return { cards: [] }; });
  const context: ContextMessage[] = [{ role: 'system', content: 'Stable prompt' },
    { role: 'user', content: '青禾资料站界面偏好', origin: 'human' }];
  const original = structuredClone(context);
  const prepared = await session.beforeModel(context, 'first');
  assert.equal(prepared.messages.length, 1); assert.match(prepared.messages[0], /L1/);
  assert.match(prepared.messages[0], /轻玻璃/); assert.equal(selected, false); assert.deepEqual(context, original);
  const state = await readRecallSessionState(dataDir, { agentId: 'a', sessionId: 's' });
  assert.equal(state?.status, 'queued');
});
test('prepared recall is append-only, deduplicated, scoped to the next input and revalidated after restart or deletion', async t => {
  const dataDir = await fixture(t);
  // A failing embedding service is represented without sending requests to a real provider.
  t.mock.method(globalThis, 'fetch', async () => { throw Error('offline fixture'); });
  const { slug } = await writeMemory(dataDir, 'a', { summary: '气旋功能岛', detail: '气旋卡片实现保留在功能岛内',
    scope: '4torm前端', originSession: 'old-session', category: 'feedback', source: 'test', now: '2026-10-30T00:00:00Z' });
  const sources = createRecallCatalog(dataDir);
  const document = await sources.read('a', `memory:${slug}`); assert.ok(document);
  const card: RecallCard = { id: document.id, revision: document.revision, kind: 'memory', title: document.title,
    level: 'L2', text: document.content };
  let calls = 0;
  const worker = async () => { calls++; return { cards: [card] }; };
  const session = new MemoryRecallSession(dataDir, { agentId: 'a', sessionId: 's' }, sources, worker);
  const context: ContextMessage[] = [{ role: 'system', content: 'Stable prompt' }, { role: 'user', content: '修改气旋卡片', origin: 'human' }];
  const original = structuredClone(context);
  assert.deepEqual((await session.beforeModel(context, 'run-one')).messages, []);
  session.startPending(); await waitForState(dataDir, 'ready');
  assert.deepEqual(context, original); assert.equal(calls, 1);
  const restored = new MemoryRecallSession(dataDir, { agentId: 'a', sessionId: 's' }, sources, worker);
  context.push({ role: 'assistant', content: '已处理' }, { role: 'user', content: '继续修改气旋卡片', origin: 'human' });
  const attached = await restored.beforeModel(context, 'run-two');
  assert.equal(attached.messages.length, 1); assert.match(attached.messages[0], /L2/);
  context.push({ role: 'user', content: attached.messages[0], origin: 'framework' });
  assert.equal((await restored.beforeModel(context, 'run-two')).messages.length, 0);
  const another = new MemoryRecallSession(dataDir, { agentId: 'a', sessionId: 's' }, sources, worker);
  context.push({ role: 'user', content: '气旋卡片继续', origin: 'human' });
  assert.equal((await another.beforeModel(context, 'run-three')).messages.length, 0);
  const unrelated = new MemoryRecallSession(dataDir, { agentId: 'a', sessionId: 's' }, sources, worker);
  assert.equal((await unrelated.beforeModel([{ role: 'user', content: '聊聊唐朝历史', origin: 'human' }], 'history')).messages.length, 0);
  await deleteMemory(dataDir, 'a', slug);
  assert.equal(await sources.read('a', card.id), null);
  assert.equal(context[0].content, 'Stable prompt');
});
test('a cancelled old search cannot overwrite a new input or another runner instance', async t => {
  const dataDir = await fixture(t);
  t.mock.method(globalThis, 'fetch', async () => { throw Error('offline fixture'); });
  await writeMemory(dataDir, 'a', { summary: '气旋卡片', detail: '功能岛', category: 'fact', source: 'test', now: new Date().toISOString() });
  const sources = createRecallCatalog(dataDir);
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const first = new MemoryRecallSession(dataDir, { agentId: 'a', sessionId: 's' }, sources, async () => {
    entered(); await new Promise<void>(resolve => { release = resolve; }); return { cards: [] };
  });
  await first.beforeModel([{ role: 'user', content: '气旋卡片', origin: 'human' }], 'old'); first.startPending(); await waiting;
  const next = new MemoryRecallSession(dataDir, { agentId: 'a', sessionId: 's' }, sources);
  await next.beforeModel([{ role: 'user', content: '唐朝历史', origin: 'human' }], 'new');
  release(); await new Promise(resolve => setTimeout(resolve, 30));
  const current = await readRecallSessionState(dataDir, { agentId: 'a', sessionId: 's' });
  assert.equal(current?.query, '唐朝历史'); assert.equal(current?.status, 'queued');
});

test('automatic keyword recall works without either model and disabling it stops preparation and delivery', async t => {
  const dataDir = await fixture(t);
  const network = t.mock.method(globalThis, 'fetch', async () => { throw Error('model-free mode must not use a provider'); });
  await saveMemoryRecallSettings(dataDir, { version: 1, model: null, embeddingModel: null, enabled: true });
  await writeMemory(dataDir, 'a', { summary: '气旋卡片', detail: '气旋卡片保持功能岛独立', category: 'feedback',
    source: 'test', now: new Date().toISOString() });
  const sources = createRecallCatalog(dataDir);
  const session = new MemoryRecallSession(dataDir, { agentId: 'a', sessionId: 's' }, sources,
    async () => { throw Error('selection model must not run'); });
  const context: ContextMessage[] = [{ role: 'user', content: '气旋卡片', origin: 'human' }];
  await session.beforeModel(context, 'first'); session.startPending();
  const ready = await waitForState(dataDir, 'ready');
  assert.equal(ready.cards[0].level, 'L1');
  context.push({ role: 'user', content: '继续修改气旋卡片', origin: 'human' });
  const prepared = await session.beforeModel(context, 'second');
  assert.equal(prepared.messages.length, 1); assert.match(prepared.messages[0], /L1/);
  await saveMemoryRecallSettings(dataDir, { version: 1, model: null, embeddingModel: null, enabled: false });
  const disabled = new MemoryRecallSession(dataDir, { agentId: 'a', sessionId: 's' }, sources);
  context.push({ role: 'user', content: '气旋卡片', origin: 'human' });
  assert.deepEqual((await disabled.beforeModel(context, 'off')).messages, []);
  disabled.startPending();
  assert.equal((await loadMemoryRecallSettings(dataDir)).enabled, false);
  assert.equal(network.mock.callCount(), 0);
});

test('changing recall configuration invalidates previously prepared cards', async t => {
  const dataDir = await fixture(t);
  await saveMemoryRecallSettings(dataDir, { version: 1, model: null, enabled: true });
  await writeMemory(dataDir, 'a', { summary: '气旋卡片', detail: '功能岛独立', category: 'feedback', source: 'test', now: new Date().toISOString() });
  const sources = createRecallCatalog(dataDir);
  const session = new MemoryRecallSession(dataDir, { agentId: 'a', sessionId: 's' }, sources);
  const context: ContextMessage[] = [{ role: 'user', content: '气旋卡片', origin: 'human' }];
  await session.beforeModel(context, 'first'); session.startPending(); await waitForState(dataDir, 'ready');
  await saveMemoryRecallSettings(dataDir, { version: 1, model: 'p:recall', enabled: true });
  const restored = new MemoryRecallSession(dataDir, { agentId: 'a', sessionId: 's' }, sources);
  context.push({ role: 'user', content: '气旋卡片', origin: 'human' });
  const attached = await restored.beforeModel(context, 'changed');
  assert.equal(attached.messages.length, 1); assert.match(attached.messages[0], /L1/); // A new lookup replaces stale prepared cards.
});

test('Level 1 alone skips the selection worker while Level 2 alone can search without embedding requests', async t => {
  const dataDir = await fixture(t);
  const network = t.mock.method(globalThis, 'fetch', async () => { throw Error('no embeddings when Level 1 is off'); });
  const { slug } = await writeMemory(dataDir, 'a', { summary: '气旋卡片', detail: '气旋功能岛保持独立',
    category: 'feedback', source: 'test', now: new Date().toISOString() });
  const sources = createRecallCatalog(dataDir);
  await saveMemoryRecallSettings(dataDir, { version: 1, model: 'p:recall', level1Enabled: true, level2Enabled: false });
  const indexed = new MemoryRecallSession(dataDir, { agentId: 'a', sessionId: 's' }, sources,
    async () => { throw Error('Level 2 is off'); });
  await indexed.beforeModel([{ role: 'user', content: '气旋卡片', origin: 'human' }], 'indexed');
  indexed.startPending(); assert.equal((await waitForState(dataDir, 'ready')).cards[0].level, 'L1');
  await saveMemoryRecallSettings(dataDir, { version: 1, model: 'p:recall', embeddingModel: 'p:embed',
    level1Enabled: false, level2Enabled: true });
  let calls = 0;
  const assisted = new MemoryRecallSession(dataDir, { agentId: 'a', sessionId: 's' }, sources, async input => {
    calls++; assert.ok(input.candidates.some(candidate => candidate.id === `memory:${slug}`)); assert.equal(input.embeddingModel, null);
    const found = JSON.parse(await executeRecallTool(dataDir, 'a', sources, 'recall_search', { query: '气旋' }));
    assert.equal(found.records[0].id, `memory:${slug}`);
    const document = await sources.read('a', found.records[0].id); assert.ok(document);
    return { cards: [{ id: document.id, revision: document.revision, kind: document.kind, title: document.title,
      level: 'L2', text: document.content }] };
  });
  const context: ContextMessage[] = [{ role: 'user', content: '气旋卡片', origin: 'human' }];
  assert.deepEqual((await assisted.beforeModel(context, 'assisted')).messages, []);
  assisted.startPending(); assert.equal((await waitForState(dataDir, 'ready')).cards[0].level, 'L2');
  assert.equal(calls, 1); assert.equal(network.mock.callCount(), 0);
  await new MemoryRecallSettingsService(dataDir).write({ version: 1, model: 'p:recall', embeddingModel: 'p:embed',
    level1Enabled: false, level2Enabled: false });
  context.push({ role: 'user', content: '气旋卡片', origin: 'human' });
  assert.deepEqual((await assisted.beforeModel(context, 'disabled')).messages, []);
  assert.equal((await loadMemoryRecallSettings(dataDir)).model, 'p:recall');
  assert.ok(await sources.read('a', `memory:${slug}`));
});

test('saving disabled levels cancels an in-flight helper without delivering its prepared result', async t => {
  const dataDir = await fixture(t);
  await saveMemoryRecallSettings(dataDir, { version: 1, model: 'p:recall', level1Enabled: false, level2Enabled: true });
  let entered!: () => void, signal: AbortSignal | undefined;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const session = new MemoryRecallSession(dataDir, { agentId: 'a', sessionId: 's' }, createRecallCatalog(dataDir), async input => {
    signal = input.signal; entered();
    await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve(), { once: true }));
    return { cards: [] };
  });
  await session.beforeModel([{ role: 'user', content: '气旋卡片', origin: 'human' }], 'search');
  session.startPending(); await started;
  await new MemoryRecallSettingsService(dataDir).write({ version: 1, model: 'p:recall', level1Enabled: false, level2Enabled: false });
  assert.equal(signal?.aborted, true);
  assert.equal((await waitForState(dataDir, 'cancelled')).cards.length, 0);
});

test('background recall retains the structured failure code without delivering cards', async t => {
  const dataDir = await fixture(t);
  await saveMemoryRecallSettings(dataDir, { version: 1, model: 'p:recall', level1Enabled: false, level2Enabled: true });
  const session = new MemoryRecallSession(dataDir, { agentId: 'a', sessionId: 's' }, createRecallCatalog(dataDir),
    async () => { throw frameworkError({ code: 'MEMORY_RECALL_SOURCE_UNAVAILABLE', kind: 'conflict',
      message: '所选记忆来源已变更', source: 'memory-recall', retryable: false }); });
  await session.beforeModel([{ role: 'user', content: '气旋卡片', origin: 'human' }], 'search');
  session.startPending();
  const state = await waitForState(dataDir, 'failed');
  assert.equal(state.error, 'MEMORY_RECALL_SOURCE_UNAVAILABLE'); assert.deepEqual(state.cards, []);
});
