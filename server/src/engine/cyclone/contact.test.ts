import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createWorkshop } from './workshop-store.js';
import { addSeat, loadSeat } from './seat-store.js';
import { persistContactMessage } from './contact.js';

test('联络入站消息先落盘，目标工位可在回复前看到人类侧气泡', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-contact-inbound-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir);
  const seat = await addSeat(dataDir, workshop.id, { agentId: 'agent-b', title: '执行工位' });

  await persistContactMessage(dataDir, workshop.id, seat, '分析工位', '请检查这份资料');

  const saved = await loadSeat(dataDir, workshop.id, seat.id);
  assert.equal(saved?.messages[0]?.role, 'user');
  assert.match(saved?.messages[0]?.content || '', /来自工位「分析工位」的联络/);
  assert.match(saved?.messages[0]?.content || '', /请检查这份资料/);
});
