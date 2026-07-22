import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createWorkshop } from './workshop-store.js';
import { addSeat, loadSeat, saveSeat, updateSeatRole } from './seat-store.js';

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
