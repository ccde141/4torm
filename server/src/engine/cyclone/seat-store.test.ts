import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createWorkshop } from './workshop-store.js';
import { addSeat, deleteSeat, loadSeat, saveSeat, updateSeatRole } from './seat-store.js';
import { loadWorkshop } from './workshop-store.js';
import { workshopBakDir } from './paths.js';

test('工位换绑 Agent 时完整保留原有工位上下文与配置', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-seat-rebind-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '测试' });
  const seat = await addSeat(dataDir, workshop.id, {
    agentId: 'agent-a', title: '后端', rolePrompt: '保持接口稳定', duty: '实现后端',
  });
  seat.messages = [{ role: 'user', content: '保留这段历史' }];
  seat.pending = {
    question: '注册工具？',
    native: false,
    toolRegistration: {
      tool: {
        name: 'seat_tool', description: '工位工具', category: 'custom', dangerous: false,
        executorType: 'custom', executorFile: 'seat_tool',
        parameters: { type: 'object', properties: {} },
      },
    },
  };
  seat.tokenUsage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
  await saveSeat(dataDir, workshop.id, seat);

  const updated = await updateSeatRole(dataDir, workshop.id, seat.id, { agentId: 'agent-b' });
  assert.equal(updated?.agentId, 'agent-b');
  assert.deepEqual(updated?.messages, seat.messages);
  assert.deepEqual(updated?.pending, seat.pending);
  assert.deepEqual(updated?.tokenUsage, seat.tokenUsage);
  assert.equal(updated?.rolePrompt, '保持接口稳定');
  assert.equal(updated?.duty, '实现后端');
  assert.equal(updated?.createdAt, seat.createdAt);
  assert.equal((await loadSeat(dataDir, workshop.id, seat.id))?.agentId, 'agent-b');
});

test('岗位历史归档失败时不移除活动工位与原始会话', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-seat-retire-io-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir);
  const seat = await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: '资料员' });
  seat.messages.push({ role: 'user', content: '原会话不能丢失' });
  await saveSeat(dataDir, workshop.id, seat);
  const parent = path.join(workshopBakDir(dataDir, workshop.id), 'retired-seats');
  await fs.mkdir(parent, { recursive: true });
  await fs.writeFile(path.join(parent, seat.id), '阻止归档目录创建');
  await assert.rejects(() => deleteSeat(dataDir, workshop.id, seat.id));
  assert.ok((await loadWorkshop(dataDir, workshop.id))?.seatIds.includes(seat.id));
  assert.deepEqual((await loadSeat(dataDir, workshop.id, seat.id))?.messages, seat.messages);
});

test('并行创建与改名共享工作室名称事务，旧快照不能写回已退休工位', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-seat-title-transaction-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir);
  const creates = await Promise.allSettled(Array.from({ length: 4 }, () => addSeat(dataDir, workshop.id,
    { agentId: 'agent-a', title: '同名岗位' })));
  assert.equal(creates.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await loadWorkshop(dataDir, workshop.id))?.seatIds.length, 1);
  const first = await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: '岗位甲' });
  const second = await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: '岗位乙' });
  const renames = await Promise.allSettled([first, second].map(seat =>
    updateSeatRole(dataDir, workshop.id, seat.id, { title: '唯一新名' })));
  assert.equal(renames.filter(result => result.status === 'fulfilled').length, 1);
  await deleteSeat(dataDir, workshop.id, first.id);
  first.messages.push({ role: 'assistant', content: '迟到的执行快照' });
  await assert.rejects(saveSeat(dataDir, workshop.id, first), /已移除/);
  assert.equal(await loadSeat(dataDir, workshop.id, first.id), null);
});
