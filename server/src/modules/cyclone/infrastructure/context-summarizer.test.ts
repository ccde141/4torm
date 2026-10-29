import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ContextMessage } from '../../../engine/shared/types.js';
import { saveSeat, loadSeat } from '../../../engine/cyclone/seat-store.js';
import { saveRoom, loadRoom } from '../../../engine/cyclone/room-store.js';
import { createCycloneFeature } from '../api/factory.js';
import { LlmCycloneContextSummarizer } from './context-summarizer.js';
import { toCycloneSummaryMessages } from '../domain/context-summary.js';

async function fixture(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-manual-context-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    worker: { name: 'Worker', model: 'p:model' },
  }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [
    { id: 'p', baseUrl: 'https://isolated-compaction.test/v1', models: ['model'], nativeMode: 'text' },
  ] }));
  const requests: Array<{ messages: Array<{ role: string; content: string }>; max_tokens: number }> = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    assert.equal(String(_input), 'https://isolated-compaction.test/v1/chat/completions');
    requests.push(request);
    return new Response('data: ' + JSON.stringify({ choices: [{
      delta: { content: '早期核验已完成，按近期目标继续。' }, finish_reason: 'stop',
    }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  };
  t.after(() => { globalThis.fetch = previous; });
  return { dataDir, requests };
}

test('普通工位手动压缩经过共享计划，保留最近四轮完整工具配对和回复', async t => {
  const { dataDir, requests } = await fixture(t);
  const feature = createCycloneFeature({ dataDir });
  const workshop = await feature.workshops.create({ title: '隔离工位' });
  const seat = await feature.workshops.addSeat({ workshopId: workshop.id, agentId: 'worker', title: '研究' });
  const source: ContextMessage[] = [
    { role: 'user', content: '早期目标'.repeat(300) },
    { role: 'assistant', content: '早期证据'.repeat(300) },
    ...Array.from({ length: 4 }, (_, index): ContextMessage[] => [
      { role: 'user', content: `近期目标-${index}` },
      { role: 'assistant', content: '', toolCalls: [{ id: `call-${index}`, name: 'read_file', arguments: '{"path":"evidence.md"}' }] },
      { role: 'tool', content: `工具证据-${index}`, toolCallId: `call-${index}` },
      { role: 'assistant', content: `近期答复-${index}` },
    ]).flat(),
  ];
  await saveSeat(dataDir, workshop.id, { ...seat, messages: source });
  await feature.seats.reset(workshop.id, seat.id, { mode: 'summary' });
  const saved = await loadSeat(dataDir, workshop.id, seat.id);
  assert.ok(saved);
  assert.deepEqual(saved.messages.slice(1), source.slice(2));
  assert.deepEqual(saved.displayHistory?.messages.slice(0, source.length), source);
  assert.equal(requests.length, 1);
  assert.ok(requests[0].max_tokens <= 32_048);
  assert.match(JSON.stringify(requests[0].messages), /早期证据/);
  assert.doesNotMatch(JSON.stringify(requests[0].messages), /近期目标-/);
});

test('普通公共群聊压缩保留三个人类轮次中的全部成员回复和工具事实', async t => {
  const { dataDir, requests } = await fixture(t);
  const feature = createCycloneFeature({ dataDir });
  const workshop = await feature.workshops.create({ title: '隔离群聊', chairAgentId: 'worker' });
  const room = await feature.rooms.create({ workshopId: workshop.id, title: '评审' });
  room.publicMessages = Array.from({ length: 4 }, (_, round) => [
    { speaker: '人类', content: `${round ? '当前议题' : '早期议题'.repeat(200)}-${round}`, timestamp: round * 3 },
    { speaker: '研究员', content: `研究结论-${round}`, timestamp: round * 3 + 1,
      toolCalls: [{ tool: 'read_file', args: { path: 'evidence.md' }, result: `已读取-${round}` }] },
    { speaker: '检查员', content: `检查结论-${round}`, timestamp: round * 3 + 2 },
  ]).flat();
  const source = structuredClone(room.publicMessages);
  await saveRoom(dataDir, workshop.id, room);
  await feature.rooms.reset(workshop.id, room.id, { mode: 'summary', scope: 'public' });
  const saved = await loadRoom(dataDir, workshop.id, room.id);
  assert.deepEqual(saved?.publicMessages.slice(1), source.slice(3));
  assert.equal(requests.length, 1);
});

test('近期不足轮数且不足30K时不调用摘要模型、不改变输入', async t => {
  const { dataDir, requests } = await fixture(t);
  const messages: ContextMessage[] = [{ role: 'user', content: '当前目标' }, { role: 'assistant', content: '当前进展' }];
  const before = structuredClone(messages);
  await assert.rejects(new LlmCycloneContextSummarizer(dataDir).summarize({
    agentId: 'worker', subject: '工位', messages: toCycloneSummaryMessages(messages),
  }), /近期原文保护/);
  assert.deepEqual(messages, before);
  assert.equal(requests.length, 0);
});
