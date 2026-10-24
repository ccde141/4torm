import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { observeModelRequests, type ModelRequestUsageEvent } from '../shared/model-request-usage.js';
import { createWorkshop } from './workshop-store.js';
import { addSeat, saveSeat } from './seat-store.js';
import { createRoom } from './room-store.js';
import { rememberChairContextBoundary } from './chair-context.js';
import { estimateChairCurrentInput, estimateRoomCurrentInput, estimateSeatCurrentInput,
  estimateSupervisorCurrentInput } from './current-input.js';
import { projectSeatContinuityContext } from './seat-continuity.js';
import { enqueueSupervisorInformation, loadSupervisor, mutateSupervisor, readSupervisorInbox } from './supervisor-store.js';
import { registerSupervisorTools } from './supervisor-tools.js';
import { createSeatDispatchRecord, deliverSeatDispatchReceipts } from './seat-dispatch.js';
import { loadDispatch, updateDispatch } from './dispatch-store.js';

async function fixture(t: TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-current-input-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    worker: { name: 'Worker', model: 'fixture:worker', config: { tools: [], toolMode: 'selected' } },
    chair: { name: 'Chair', model: 'fixture:chair', config: { tools: [], toolMode: 'selected' } },
  }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'fixture', baseUrl: 'https://input-preview.invalid/v1', models: ['worker', 'chair'],
    providerType: 'openai-compatible',
  }] }));
  const workshop = await createWorkshop(dataDir, { title: 'Input workshop', chairAgentId: 'chair' });
  const seat = await addSeat(dataDir, workshop.id, { agentId: 'worker', title: 'Research' });
  const room = await createRoom(dataDir, workshop.id, { title: 'Discussion', participantSeatIds: [seat.id] });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Read estimates must not use the network'); });
  return { dataDir, workshop, seat, room };
}

test('seat input estimates are immediately available and shrink with the effective context', async t => {
  const { dataDir, workshop, seat } = await fixture(t);
  const events: ModelRequestUsageEvent[] = [];
  seat.messages = [{ role: 'user', content: '旧记录'.repeat(5_000) }];
  const before = JSON.stringify(seat);
  const large = await observeModelRequests(event => events.push(event),
    () => estimateSeatCurrentInput(dataDir, workshop.id, seat));
  assert.equal(JSON.stringify(seat), before);
  seat.messages = [{ role: 'system', content: '[会话归档摘要]保留结论' },
    { role: 'user', content: '当前原文' }];
  const compact = await estimateSeatCurrentInput(dataDir, workshop.id, seat);
  assert.ok(compact.tokens < large.tokens);
  seat.messages = [];
  const empty = await estimateSeatCurrentInput(dataDir, workshop.id, seat);
  assert.ok(empty.tokens > 0, 'old sessions emptied by editing still have a base prompt and tool schemas');
  assert.ok(empty.tokens < compact.tokens);
  assert.equal(empty.model, 'fixture:worker');
  assert.deepEqual(events, []);
  assert.equal(seat.modelUsage, undefined);
});

test('room estimates do not include seat private history, and chair estimates use only effective compacted context', async t => {
  const { dataDir, workshop, seat, room } = await fixture(t);
  room.publicMessages.push({ speaker: '人类', content: '公开发言'.repeat(2_000), timestamp: 2 });
  const publicBefore = await estimateRoomCurrentInput(dataDir, workshop.id, room);
  seat.messages = [{ role: 'user', content: '工位私聊'.repeat(10_000) }];
  await saveSeat(dataDir, workshop.id, seat);
  assert.equal((await estimateRoomCurrentInput(dataDir, workshop.id, room))?.tokens, publicBefore?.tokens);
  room.chairMessages = [{ role: 'user', content: '旧私聊'.repeat(2_000) }];
  const chairBefore = await estimateChairCurrentInput(dataDir, workshop.id, room);
  room.chairActiveContext = [{ role: 'system', content: '有效摘要' }];
  rememberChairContextBoundary(room);
  const compact = await estimateChairCurrentInput(dataDir, workshop.id, room);
  assert.ok(compact.tokens < chairBefore.tokens);
  room.chairMessages.push({ role: 'user', content: '保留的最新消息' });
  assert.ok((await estimateChairCurrentInput(dataDir, workshop.id, room)).tokens > compact.tokens);
  assert.equal((await estimateRoomCurrentInput(dataDir, workshop.id, room))?.tokens, publicBefore?.tokens);
});

test('seat estimate includes due dispatch receipts without consuming their delivery', async t => {
  const { dataDir, workshop, seat } = await fixture(t);
  const target = await addSeat(dataDir, workshop.id, { agentId: 'worker', title: 'Check' });
  const before = await estimateSeatCurrentInput(dataDir, workshop.id, seat);
  const dispatch = await createSeatDispatchRecord(dataDir, { workshopId: workshop.id,
    sourceSeatId: seat.id, sourceSeatTitle: seat.title, sourceTurnId: 'preview-turn', dispatchOrder: 0,
    targetSeatTitle: target.title, task: '核验结果' });
  await updateDispatch(dataDir, workshop.id, dispatch.id, {
    status: 'completed', response: '完整的核验回报'.repeat(500),
  });
  const projected = await estimateSeatCurrentInput(dataDir, workshop.id, seat);
  assert.ok(projected.tokens > before.tokens);
  assert.equal(seat.messages.length, 0);
  assert.equal((await loadDispatch(dataDir, workshop.id, dispatch.id))?.receiptState, 'pending');
  assert.equal(await deliverSeatDispatchReceipts(dataDir, workshop.id, seat), 1);
  assert.equal((await estimateSeatCurrentInput(dataDir, workshop.id, seat)).tokens, projected.tokens);
});

test('provider configuration failure falls back to a marked canonical estimate', async t => {
  const { dataDir, workshop, seat } = await fixture(t);
  await fs.writeFile(path.join(dataDir, 'providers.json'), '{broken');
  const estimate = await estimateSeatCurrentInput(dataDir, workshop.id, seat);
  assert.ok(estimate.tokens > 0);
  assert.equal(estimate.basis, 'canonical');
});

test('supervisor estimates observe pending information without consuming it or changing goal state', async t => {
  const { dataDir, workshop } = await fixture(t);
  const release = registerSupervisorTools(dataDir, { definitions: [],
    call: async () => { throw new Error('Read must not execute tools'); },
    report: async () => { throw new Error('Read must not send messages'); } });
  t.after(release);
  await mutateSupervisor(dataDir, workshop.id, current => { current.agentId = 'worker'; });
  const supervisor = await loadSupervisor(dataDir, workshop.id);
  const before = await estimateSupervisorCurrentInput(dataDir, workshop.id, supervisor);
  await enqueueSupervisorInformation(dataDir, workshop.id, { id: 'info-fixture', sourceKind: 'seat',
    sourceId: 'source-seat', sourceTitle: 'Research', content: '仍待处理的核验回报'.repeat(300) });
  const inbox = await readSupervisorInbox(dataDir, workshop.id);
  const after = await estimateSupervisorCurrentInput(dataDir, workshop.id, supervisor);
  assert.ok(after!.tokens > before!.tokens);
  assert.deepEqual(await readSupervisorInbox(dataDir, workshop.id), inbox);
  assert.equal(supervisor.modelUsage, undefined);
  assert.equal(supervisor.humanIntentEstablished, undefined);
});

test('continuity preview includes the same request cue without advancing the seat watermark', () => {
  const seat = { id: 's', title: 'Seat', agentId: 'a', rolePrompt: '', messages: [], createdAt: '', updatedAt: '',
    compactState: { disabled: false, archiveSeq: 1, lastCompactAt: '2026-10-24T00:00:00Z' } };
  const source = [{ role: 'system' as const, content: 'base' }];
  const context = projectSeatContinuityContext(source, seat, 'solo');
  assert.match(context[0].content, /接续工作/);
  assert.equal(source[0].content, 'base');
  assert.equal('historySeen' in seat, false);
});
