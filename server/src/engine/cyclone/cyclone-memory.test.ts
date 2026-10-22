import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildCycloneMemoryPrompt,
  executeCycloneMemoryTool,
  withCycloneMemoryTools,
} from './cyclone-memory.js';
import { createWorkshop } from './workshop-store.js';
import { addSeat, updateSeatRole } from './seat-store.js';
import { readSeatMemory, saveSeatMemory, seatMemoryFile, subscribeSeatMemoryChanges } from './seat-memory.js';
import { makeToolCaller } from './seat-runner.js';
import { makeRoomToolCaller } from './room-runner.js';
import { createDispatchStartBuffer } from './dispatch-start-buffer.js';
import { normalizeToolCallResult } from '../shared/react/native-loop.js';

test('气旋工位使用绑定 Agent 的长期记忆工具与召回', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-memory-'));
  try {
    const tools = withCycloneMemoryTools([]);
    assert.deepEqual(tools.map(tool => tool.name), [
      'memory_write', 'memory_list', 'memory_read',
    ]);

    const written = await executeCycloneMemoryTool(dataDir, 'agent-a', 'memory_write', {
      summary: '气旋测试偏好', detail: '用户偏好短句结论。', category: 'feedback', tags: '气旋,测试',
    });
    assert.match(written!, /已记入长期记忆/);
    assert.match(await executeCycloneMemoryTool(dataDir, 'agent-a', 'memory_list', {}) ?? '', /气旋测试偏好/);

    const prompt = await buildCycloneMemoryPrompt(dataDir, 'agent-a', '气旋测试偏好');
    assert.match(prompt, /你的经验记忆/);
    assert.match(prompt, /memory_write/);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('非记忆工具不被气旋记忆执行器截获', async () => {
  assert.equal(await executeCycloneMemoryTool('unused', 'agent-a', 'read_file', {}), null);
});

test('工位记忆按岗位隔离且换绑后保留；池中 Agent 记忆仍保持原归属', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-local-memory-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir);
  const a = await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: '甲' });
  const b = await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: '乙' });
  const scope = { workshopId: workshop.id, seatId: a.id };
  await executeCycloneMemoryTool(dataDir, 'agent-a', 'memory_write', {
    summary: '通用方法', detail: '可跨项目复用', category: 'fact', tags: '方法',
  });
  const board = await saveSeatMemory(dataDir, workshop.id, a.id, 0, { title: '项目约定', content: '仅属于甲工位' });
  await updateSeatRole(dataDir, workshop.id, a.id, { agentId: 'agent-b' });
  assert.deepEqual(await readSeatMemory(dataDir, workshop.id, a.id), board);
  assert.deepEqual(await readSeatMemory(dataDir, workshop.id, b.id), { revision: 0, entries: [] });
  assert.match(await executeCycloneMemoryTool(dataDir, 'agent-a', 'memory_list', {}) ?? '', /通用方法/);
  assert.doesNotMatch(await executeCycloneMemoryTool(dataDir, 'agent-b', 'memory_list', {}) ?? '', /通用方法/);
  assert.match(await buildCycloneMemoryPrompt(dataDir, 'agent-b', '项目约定', scope), /项目约定/);
});

test('同版本并发写入只有一次提交；损坏记忆持续报错且保留原文件', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-memory-cas-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir);
  const seat = await addSeat(dataDir, workshop.id, { agentId: 'agent', title: '岗位' });
  const changes: string[] = [];
  const stop = subscribeSeatMemoryChanges(dataDir, (wid, sid) => changes.push(`${wid}/${sid}`));
  t.after(stop);
  const results = await Promise.allSettled(['甲', '乙'].map(content => saveSeatMemory(
    dataDir, workshop.id, seat.id, 0, { title: content, content },
  )));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.equal(failure.reason.data.code, 'CYCLONE_SEAT_MEMORY_CONFLICT');
  assert.equal(changes.length, 1);
  assert.equal((await readSeatMemory(dataDir, workshop.id, seat.id)).revision, 1);
  const file = seatMemoryFile(dataDir, workshop.id, seat.id);
  await fs.writeFile(file, '{broken', 'utf8');
  for (let i = 0; i < 2; i++) await assert.rejects(readSeatMemory(dataDir, workshop.id, seat.id));
  await assert.rejects(saveSeatMemory(dataDir, workshop.id, seat.id, 1, { title: '覆盖', content: '不可覆盖' }));
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
});

test('私聊与群聊副本共用本工位记忆，工具不能提供另一个岗位身份', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-memory-callers-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir);
  const seat = await addSeat(dataDir, workshop.id, { agentId: 'agent', title: '岗位' });
  const base = { dataDir, workshopId: workshop.id, seatId: seat.id, seatTitle: seat.title,
    agentId: 'agent', sandboxLevel: 'project', wsDir: '.', signal: undefined, onEvent: () => {} };
  const privateCaller = makeToolCaller({ ...base, onToolRegistration: () => {}, onExecution: () => {} });
  const roomCaller = makeRoomToolCaller({ ...base, speaker: seat.title, roomId: 'room', turnId: 'turn',
    roundSeq: 1, contextVersion: 0, dispatchStarts: createDispatchStartBuffer(() => {}) });
  assert.equal(normalizeToolCallResult(await privateCaller.call('seat_memory_write', {
    expectedRevision: '0', title: '岗位约定', content: '私聊写入',
  })).ok, true);
  const read = normalizeToolCallResult(await roomCaller.call('seat_memory_read', {}));
  const board = JSON.parse(read.result);
  assert.equal(board.revision, 1);
  assert.equal(normalizeToolCallResult(await roomCaller.call('seat_memory_write', {
    expectedRevision: '1', id: board.entries[0].id, title: '岗位约定', content: '群聊补充',
  })).ok, true);
  assert.equal((await readSeatMemory(dataDir, workshop.id, seat.id)).entries[0].content, '群聊补充');
  assert.equal(normalizeToolCallResult(await privateCaller.call('seat_memory_read', { seatId: 'other' })).ok, false);
  assert.doesNotMatch(await executeCycloneMemoryTool(dataDir, 'agent', 'memory_list', {}) ?? '', /岗位约定/);
});
