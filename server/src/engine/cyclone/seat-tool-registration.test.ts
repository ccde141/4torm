import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareToolRegistration } from '../shared/tool-registration.js';
import { applyPendingSeatResponse } from './seat-tool-registration.js';
import { addSeat, loadSeat, saveSeat } from './seat-store.js';
import { createWorkshop } from './workshop-store.js';

async function setupSeat(name: string) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-seat-tool-'));
  await fs.mkdir(path.join(dataDir, 'tools', 'executors'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'tools', 'executors', `${name}.js`), 'export default async () => "ok";');
  const workshop = await createWorkshop(dataDir, { title: '测试工作室' });
  const seat = await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: '工位' });
  seat.pending = {
    question: '注册工具？', native: false,
    toolRegistration: await prepareToolRegistration(dataDir, {
      name, description: '工位创建的工具', dangerous: 'false', executorFile: name,
      parameters: '{"type":"object","properties":{}}',
    }),
  };
  await saveSeat(dataDir, workshop.id, seat);
  return { dataDir, workshopId: workshop.id, seat };
}

test('气旋取消工具注册后清除 pending 且不修改注册表', async (t) => {
  const { dataDir, workshopId, seat } = await setupSeat('cancelled_tool');
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  await applyPendingSeatResponse(dataDir, workshopId, seat, '取消', () => undefined);

  const saved = await loadSeat(dataDir, workshopId, seat.id);
  assert.equal(saved?.pending, undefined);
  assert.match(saved?.messages.at(-1)?.content || '', /已取消注册工具/);
  await assert.rejects(() => fs.readFile(path.join(dataDir, 'tools', 'registry.json')), /ENOENT/);
});

test('气旋确认工具注册后先保存结果并清除 pending', async (t) => {
  const { dataDir, workshopId, seat } = await setupSeat('seat_registered_tool');
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const native = await applyPendingSeatResponse(dataDir, workshopId, seat, '注册', () => undefined);

  const saved = await loadSeat(dataDir, workshopId, seat.id);
  const registry = JSON.parse(await fs.readFile(path.join(dataDir, 'tools', 'registry.json'), 'utf8'));
  assert.equal(native, false);
  assert.equal(saved?.pending, undefined);
  assert.match(saved?.messages.at(-1)?.content || '', /已注册/);
  assert.deepEqual(registry.map((tool: { name: string }) => tool.name), ['seat_registered_tool']);
});
