import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { createWorkshop } from './workshop-store.js';
import { addSeat, loadSeat, saveSeat, updateSeatRole } from './seat-store.js';
import { readSeatMemory, saveSeatMemory, seatMemoryFile } from './seat-memory.js';
import { appendSeatConfigurationHistory, readSeatHistory } from './seat-history.js';
import { seatFile } from './paths.js';

async function fixture(t: TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-seat-history-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '项目甲' });
  const seat = await addSeat(dataDir, workshop.id, {
    agentId: 'agent-a', title: '资料员', rolePrompt: 'private-initial-role',
  });
  return { dataDir, workshop, seat, primary: seatFile(dataDir, workshop.id, seat.id) };
}

test('旧岗位无虚构历史；配置、绑定与协作开关变更持久保留且不复制正文', async t => {
  const { dataDir, workshop, seat, primary } = await fixture(t);
  const original = await fs.readFile(primary, 'utf8');
  assert.deepEqual(await readSeatHistory(dataDir, workshop.id, seat.id), []);
  assert.equal(await fs.readFile(primary, 'utf8'), original);
  await updateSeatRole(dataDir, workshop.id, seat.id, {
    title: '研究员', duty: '核实来源', rolePrompt: 'private-updated-role',
  }, 'human');
  await updateSeatRole(dataDir, workshop.id, seat.id, { agentId: 'agent-b' }, 'human');
  const current = (await loadSeat(dataDir, workshop.id, seat.id))!;
  const previous = { ...current };
  current.collaboration = { contact: false, dispatch: true, bulletin: true };
  appendSeatConfigurationHistory(workshop.id, previous, current, 'human');
  current.messages.push({ role: 'user', content: 'private-conversation' });
  await saveSeat(dataDir, workshop.id, current);
  await updateSeatRole(dataDir, workshop.id, seat.id, { agentId: 'agent-b' }, 'human');
  const history = await readSeatHistory(dataDir, workshop.id, seat.id);
  assert.equal(history.length, 3, '普通会话保存与无变化配置不产生新事件');
  const binding = history.find(item => item.kind === 'binding')!;
  assert.equal(binding.previousAgentId, 'agent-a');
  assert.equal(binding.agentId, 'agent-b');
  assert.deepEqual(binding.changedFields, ['agentId']);
  const configuration = history.find(item => item.changedFields?.includes('rolePrompt'))!;
  assert.deepEqual(configuration.changedFields, ['title', 'rolePrompt', 'duty']);
  assert.ok(history.some(item => item.changedFields?.includes('collaboration')));
  assert.ok(history.every(item => item.source === 'human' && item.seatId === seat.id
    && item.workshopId === workshop.id && Number.isFinite(Date.parse(item.timestamp))));
  assert.doesNotMatch(JSON.stringify(history), /private-/);
  assert.equal((await loadSeat(dataDir, workshop.id, seat.id))?.messages[0].content, 'private-conversation');
  const other = await createWorkshop(dataDir, { title: '项目乙' });
  await assert.rejects(readSeatHistory(dataDir, other.id, seat.id), /不属于/);
});

test('记忆修订与来源同次提交，旧版本并发冲突不产生重复履历，改绑不丢记忆', async t => {
  const { dataDir, workshop, seat } = await fixture(t);
  const first = await saveSeatMemory(dataDir, workshop.id, seat.id, 0,
    { title: '资料来源', content: 'private-memory-1' }, 'human');
  assert.deepEqual(Object.keys(first).sort(), ['entries', 'revision']);
  const id = first.entries[0].id;
  const results = await Promise.allSettled(['甲', '乙'].map(content => saveSeatMemory(
    dataDir, workshop.id, seat.id, 1, { id, title: '核实结论', content: `private-${content}` }, 'seat-agent',
  )));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.equal(failure.reason.data.code, 'CYCLONE_SEAT_MEMORY_CONFLICT');
  const memory = await readSeatMemory(dataDir, workshop.id, seat.id);
  await updateSeatRole(dataDir, workshop.id, seat.id, { agentId: 'agent-b' }, 'human');
  assert.deepEqual(await readSeatMemory(dataDir, workshop.id, seat.id), memory);
  const history = (await readSeatHistory(dataDir, workshop.id, seat.id))
    .filter(item => item.kind === 'memory').sort((left, right) => left.memoryRevision! - right.memoryRevision!);
  assert.equal(history.length, 2);
  assert.deepEqual(history.map(item => [item.source, item.memoryRevision, item.memoryTitle]),
    [['human', 1, '资料来源'], ['seat-agent', 2, '核实结论']]);
  assert.ok(history.every(item => item.memoryId === id));
  assert.doesNotMatch(JSON.stringify(history), /private-/);
  const stored = JSON.parse(await fs.readFile(seatMemoryFile(dataDir, workshop.id, seat.id), 'utf8'));
  assert.equal(stored.history.length, 2);
  assert.equal(stored.revision, 2);
});

test('主文件替换失败时配置、记忆和履历均不提交，解除故障后可正常重试', async t => {
  const { dataDir, workshop, seat, primary } = await fixture(t);
  await saveSeatMemory(dataDir, workshop.id, seat.id, 0, { title: '原资料', content: '原正文' }, 'human');
  const memoryFile = seatMemoryFile(dataDir, workshop.id, seat.id);
  const seatBefore = await fs.readFile(primary, 'utf8');
  const memoryBefore = await fs.readFile(memoryFile, 'utf8');
  const rename = fs.rename;
  let blocked = primary;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (String(to) === blocked) throw Object.assign(new Error('fixture replacement failed'), { code: 'EIO' });
    return rename(from, to);
  });
  await assert.rejects(updateSeatRole(dataDir, workshop.id, seat.id, { agentId: 'agent-b' }, 'human'), /fixture/);
  assert.equal(await fs.readFile(primary, 'utf8'), seatBefore);
  blocked = memoryFile;
  await assert.rejects(saveSeatMemory(dataDir, workshop.id, seat.id, 1,
    { title: '失败资料', content: '不应提交' }, 'seat-agent'), /fixture/);
  assert.equal(await fs.readFile(memoryFile, 'utf8'), memoryBefore);
  assert.equal((await readSeatHistory(dataDir, workshop.id, seat.id)).length, 1);
  blocked = '';
  await saveSeatMemory(dataDir, workshop.id, seat.id, 1, { title: '新资料', content: '新正文' }, 'seat-agent');
  assert.equal((await readSeatHistory(dataDir, workshop.id, seat.id)).length, 2);
  assert.equal((await fs.readdir(path.dirname(primary))).some(name => name.endsWith('.tmp')), false);
});

test('无履历的旧记忆保持兼容；损坏与跨工位履历明确报错且不覆盖原文件', async t => {
  const { dataDir, workshop, seat, primary } = await fixture(t);
  const memoryFile = seatMemoryFile(dataDir, workshop.id, seat.id);
  await fs.writeFile(memoryFile, JSON.stringify({ revision: 1, entries: [{
    id: 'old-memory', title: '旧资料', content: '原内容', updatedAt: new Date().toISOString(),
  }] }));
  assert.deepEqual(await readSeatHistory(dataDir, workshop.id, seat.id), []);
  await saveSeatMemory(dataDir, workshop.id, seat.id, 1, { title: '新资料', content: '新内容' });
  const memoryHistory = await readSeatHistory(dataDir, workshop.id, seat.id);
  assert.equal(memoryHistory.length, 1);
  assert.equal(memoryHistory[0].source, 'unknown');
  const badMemory = JSON.parse(await fs.readFile(memoryFile, 'utf8'));
  badMemory.history[0].seatId = 'another-seat';
  const badRaw = JSON.stringify(badMemory);
  await fs.writeFile(memoryFile, badRaw);
  for (let index = 0; index < 2; index++) {
    await assert.rejects(readSeatHistory(dataDir, workshop.id, seat.id), /履历已损坏/);
    await assert.rejects(readSeatMemory(dataDir, workshop.id, seat.id), /履历已损坏/);
  }
  assert.equal(await fs.readFile(memoryFile, 'utf8'), badRaw);
  await fs.rm(memoryFile);
  const badSeat = JSON.stringify({ ...seat, history: [{ id: 'missing-fields' }] });
  await fs.writeFile(primary, badSeat);
  await assert.rejects(readSeatHistory(dataDir, workshop.id, seat.id), /履历已损坏/);
  await assert.rejects(loadSeat(dataDir, workshop.id, seat.id), /履历已损坏/);
  assert.equal(await fs.readFile(primary, 'utf8'), badSeat);
});
