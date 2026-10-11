import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CycloneExecutionPort } from '../domain/operation-snapshot.js';
import type { CycloneContextSummarizer } from '../domain/context-summary.js';
import { CycloneChairService } from './chair-service.js';
import { CycloneRoomService } from './room-service.js';
import { CycloneWorkshopService } from './workshop-service.js';
import { saveRoom, loadRoom } from '../../../engine/cyclone/room-store.js';
import { buildCycloneChairContext, rememberChairContextBoundary } from '../../../engine/cyclone/chair-context.js';

async function fixture(t: test.TestContext, summarizer: CycloneContextSummarizer) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-chair-context-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const executions: CycloneExecutionPort = { list: () => [], signal: () => new AbortController().signal };
  const workshops = new CycloneWorkshopService(dataDir);
  const rooms = new CycloneRoomService(dataDir, executions, workshops, summarizer);
  const chairs = new CycloneChairService(dataDir, executions, workshops, rooms, summarizer);
  const workshop = await workshops.create({ chairAgentId: 'chair' });
  const room = await rooms.create({ workshopId: workshop.id });
  room.publicMessages = [{ speaker: '人类', content: '公共目标'.repeat(500), timestamp: 1 }];
  room.chairMessages = [{ role: 'user', content: '私人疑问'.repeat(500) }];
  await saveRoom(dataDir, workshop.id, room);
  return { dataDir, workshop, room, rooms, chairs };
}

test('气旋会长 /compact 汇总完整公共观察与私聊，归档原文且后续不重复追加来源', async t => {
  const { dataDir, workshop, room, chairs } = await fixture(t, { summarize: async input => {
    assert.equal(input.kind, 'meeting');
    assert.match(JSON.stringify(input.messages), /公共目标/);
    assert.match(JSON.stringify(input.messages), /私人疑问/);
    return '公共目标与私人疑问已整理';
  } });
  const result = await chairs.reset(workshop.id, room.id, 'summary');
  assert.ok(result.archivePath);
  const archive = JSON.parse(await fs.readFile(result.archivePath, 'utf8'));
  assert.deepEqual(archive.publicMessages, room.publicMessages);
  assert.deepEqual(archive.chairMessages, room.chairMessages);
  const saved = await loadRoom(dataDir, workshop.id, room.id);
  assert.ok(saved);
  assert.deepEqual(saved.publicMessages, room.publicMessages);
  const context = buildCycloneChairContext(saved, { role: 'system', content: '身份' });
  assert.equal(context.length, 2);
  assert.match(context[1].content, /公共目标与私人疑问已整理/);
});

test('会长 /reset 只清私聊真实上下文，公共/reset 不允许旧摘要重新进入模型', async t => {
  const { dataDir, workshop, room, rooms, chairs } = await fixture(t, { summarize: async () => '摘要' });
  room.chairActiveContext = [{ role: 'system', content: '旧摘要不得复活' }];
  rememberChairContextBoundary(room);
  await saveRoom(dataDir, workshop.id, room);
  await chairs.reset(workshop.id, room.id, 'clear');
  let saved = await loadRoom(dataDir, workshop.id, room.id); assert.ok(saved);
  assert.equal(saved.chairActiveContext, undefined);
  assert.deepEqual(saved.publicMessages, room.publicMessages);
  assert.doesNotMatch(JSON.stringify(buildCycloneChairContext(saved, { role: 'system', content: '身份' })), /旧摘要不得复活|私人疑问/);
  saved.chairActiveContext = [{ role: 'system', content: '公共旧摘要' }];
  rememberChairContextBoundary(saved);
  await saveRoom(dataDir, workshop.id, saved);
  await rooms.reset(workshop.id, room.id, { scope: 'public', mode: 'clear' });
  saved = await loadRoom(dataDir, workshop.id, room.id); assert.ok(saved);
  assert.deepEqual(buildCycloneChairContext(saved, { role: 'system', content: '身份' }), [{ role: 'system', content: '身份' }]);
});
