import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defaultCompactionPolicy, saveCompactionPolicy } from '../shared/compaction/index.js';
import { createWorkshop } from './workshop-store.js';
import { addSeat } from './seat-store.js';
import { createRoom, loadRoom } from './room-store.js';
import { speakInRoom } from './room-runner.js';
import { cycloneMeetingContext } from './meeting-compaction-caller.js';
import { buildCycloneChairContext } from './chair-context.js';
import { registerSeatFactReader } from './seat-fact-tools.js';
import { formatTextToolCall } from '../shared/text-tool-protocol.js';
import { resolveToolTransportContract } from '../../model-runtime/config/tool-transport-contract.js';

function stream(delta: Record<string, unknown>, finish = 'stop') {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\n\n`
    + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
}

function providerFixture(native: boolean, baseUrl: string) {
  const provider = { id: 'p', baseUrl, models: ['worker', 'chair'] };
  return { ...provider, toolTransports: Object.fromEntries(provider.models.map(model => [model, {
    status: native ? 'native-confirmed' : 'text-required', checkedAt: '2026-01-01T00:00:00Z',
    fingerprint: resolveToolTransportContract(provider, model).fingerprint,
  }])) };
}

for (const native of [true, false]) for (const failure of [false, true]) {
  test(`a ${failure ? 'failed' : 'completed'} ${native ? 'native' : 'text'} room turn keeps its display tools without feeding summarized work back after reload`, async t => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-room-replay-'));
    t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
    await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
    await fs.writeFile(path.join(dataDir, 'agents/registry.json'), JSON.stringify({
      worker: { name: 'Worker', model: 'p:worker', tools: [], skills: [], toolMode: 'selected' },
      chair: { name: 'Chair', model: 'p:chair', tools: [], skills: [], toolMode: 'selected' },
    }));
    await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [
      providerFixture(native, 'https://room-replay.test/v1'),
    ] }));
    const policy = defaultCompactionPolicy();
    await saveCompactionPolicy(dataDir, { ...policy, enabled: true,
      thresholds: { ...policy.thresholds, cycloneMeeting: 40_000 } });
    const workshop = await createWorkshop(dataDir, { title: 'Fixture', chairAgentId: 'chair' });
    const seat = await addSeat(dataDir, workshop.id, { title: 'Worker', agentId: 'worker' });
    const room = await createRoom(dataDir, workshop.id, { title: 'Discussion', participantSeatIds: [seat.id] });
    let facts = 0, summaries = 0, modelCalls = 0;
    t.after(registerSeatFactReader(dataDir, async () => ({
      evidence: `TOOL-EVIDENCE-${++facts}:` + '据'.repeat(25_000),
    })));
    t.mock.method(globalThis, 'fetch', async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      if (JSON.stringify(body.messages.at(-1)).includes('你负责把已有会话整理')) {
        summaries++;
        return stream({ content: 'Older evidence is verified. Continue TASK-42.' });
      }
      assert.equal(Boolean(body.tools?.length), native, 'the fixture must exercise the selected transport');
      modelCalls++;
      if (summaries) {
        assert.doesNotMatch(JSON.stringify(body.messages), /TOOL-EVIDENCE-1:/);
        if (failure) return new Response('{"error":{"message":"Fixture failure"}}', { status: 400 });
        return stream({ content: 'TASK-42 complete.' });
      }
      assert.ok(modelCalls < 15, 'the fixture must eventually compact its accumulated tool results');
      return native ? stream({ content: `VISIBLE-PROGRESS-${modelCalls}:`, tool_calls: [{ index: 0, id: `fact-${modelCalls}`,
        type: 'function', function: { name: 'seat_activity_read', arguments: '{}' } }] }, 'tool_calls')
        : stream({ content: formatTextToolCall('seat_activity_read', {}) });
    });
    const run = speakInRoom(dataDir, workshop.id, room, 'Continue TASK-42.', () => {});
    if (failure) await assert.rejects(run, /Fixture failure|模型服务/); else await run;
    assert.ok(summaries >= 1);
    const saved = (await loadRoom(dataDir, workshop.id, room.id))!;
    const record = saved.publicMessages.at(-1)!;
    assert.ok(record.toolCalls?.some(tool => tool.result.includes('TOOL-EVIDENCE-1:')),
      'the original tool result is still available in the display transcript');
    assert.equal(typeof record.modelContent, 'string');
    const nextParticipant = JSON.stringify(cycloneMeetingContext(saved.publicMessages));
    const nextChair = JSON.stringify(buildCycloneChairContext(saved, { role: 'system', content: 'Chair rules' }));
    for (const next of [nextParticipant, nextChair]) {
      assert.doesNotMatch(next, /TOOL-EVIDENCE-1:/);
      assert.match(next, new RegExp(`TOOL-EVIDENCE-${facts}:`), 'the genuinely retained tool result must remain available');
      assert.match(next, /Older evidence is verified/);
    }
    if (failure) assert.equal(record.executionStatus, 'failed');
    else assert.equal(record.modelContent!.split('TASK-42 complete').length - 1, 1);
  });
}

for (const native of [true, false]) {
  test(`a ${native ? 'native' : 'text'} truncated room reply retains only its new failed continuation after compaction`, async t => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-room-partial-replay-'));
    t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
    await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
    await fs.writeFile(path.join(dataDir, 'agents/registry.json'), JSON.stringify({
      worker: { name: 'Worker', model: 'p:worker', tools: [], skills: [], toolMode: 'selected' },
      chair: { name: 'Chair', model: 'p:chair', tools: [], skills: [], toolMode: 'selected' },
    }));
    await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [
      providerFixture(native, 'https://room-partial-replay.test/v1'),
    ] }));
    const policy = defaultCompactionPolicy();
    await saveCompactionPolicy(dataDir, { ...policy, enabled: true,
      thresholds: { ...policy.thresholds, cycloneMeeting: 40_000 } });
    const workshop = await createWorkshop(dataDir, { title: 'Fixture', chairAgentId: 'chair' });
    const seat = await addSeat(dataDir, workshop.id, { title: 'Worker', agentId: 'worker' });
    const room = await createRoom(dataDir, workshop.id, { title: 'Discussion', participantSeatIds: [seat.id] });
    let facts = 0, summaries = 0, continuations = 0;
    t.after(registerSeatFactReader(dataDir, async () => ({
      evidence: `TOOL-EVIDENCE-${++facts}:` + '据'.repeat(25_000),
    })));
    t.mock.method(globalThis, 'fetch', async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      if (JSON.stringify(body.messages.at(-1)).includes('你负责把已有会话整理')) {
        summaries++;
        return stream({ content: 'Older evidence is verified. Continue TASK-42.' });
      }
      assert.equal(Boolean(body.tools?.length), native, 'the fixture must exercise the selected transport');
      if (!summaries) return native ? stream({ tool_calls: [{ index: 0, id: `fact-${facts}`,
        type: 'function', function: { name: 'seat_activity_read', arguments: '{}' } }] }, 'tool_calls')
        : stream({ content: formatTextToolCall('seat_activity_read', {}) });
      if (++continuations === 1) return stream({ content: 'FIRST-PART' }, 'length');
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [
          { delta: { content: 'SECOND-PART' }, finish_reason: null },
        ] })}\n\n`));
        setTimeout(() => controller.error(new Error('Fixture continuation interrupted')), 10);
      } }), { headers: { 'content-type': 'text/event-stream' } });
    });
    await assert.rejects(speakInRoom(dataDir, workshop.id, room, 'Continue TASK-42.', () => {}),
      /Fixture continuation interrupted|模型请求失败/);
    assert.equal(summaries, 1);
    assert.equal(continuations, 2);
    const saved = (await loadRoom(dataDir, workshop.id, room.id))!;
    const record = saved.publicMessages.at(-1)!;
    assert.equal(record.executionStatus, 'failed');
    for (const context of [record.modelContent!, JSON.stringify(cycloneMeetingContext(saved.publicMessages)),
      JSON.stringify(buildCycloneChairContext(saved, { role: 'system', content: 'Chair rules' }))]) {
      assert.equal(context.split('FIRST-PART').length - 1, 1);
      assert.equal(context.split('SECOND-PART').length - 1, 1);
      assert.doesNotMatch(context, /TOOL-EVIDENCE-1:/);
    }
    assert.ok(record.toolCalls?.some(tool => tool.result.includes('TOOL-EVIDENCE-1:')));
  });
}
