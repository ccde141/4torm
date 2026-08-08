import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createWorkshop } from './workshop-store.js';
import { addSeat, loadSeat, saveSeat } from './seat-store.js';
import { planSeatCompaction } from './seat-compaction.js';
import { applySeatCompaction } from './seat-compaction-store.js';

async function fixture(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-seat-compact-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '压缩测试' });
  const seat = await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: '开发' });
  seat.messages = [
    { role: 'user', content: '第一轮' }, { role: 'assistant', content: '答一' },
    { role: 'user', content: '第二轮' }, { role: 'assistant', content: '答二' },
    { role: 'user', content: '第三轮' }, { role: 'assistant', content: '答三' },
    { role: 'user', content: '第四轮' }, { role: 'assistant', content: '答四' },
  ];
  seat.tokenUsage = { promptTokens: 9_000, completionTokens: 20, totalTokens: 9_020 };
  await saveSeat(dataDir, workshop.id, seat);
  const plan = planSeatCompaction(seat.messages, seat.tokenUsage.promptTokens);
  assert.equal(plan.ok, true);
  if (!plan.ok) throw new Error('测试数据未形成压缩计划');
  return { dataDir, workshop, seat, plan };
}

test('摘要为空时拒绝写入，活动上下文和归档均保持不变', async (t) => {
  const { dataDir, workshop, seat, plan } = await fixture(t);
  await assert.rejects(
    applySeatCompaction(dataDir, workshop.id, seat, plan, '   '),
    /摘要为空/,
  );
  assert.deepEqual((await loadSeat(dataDir, workshop.id, seat.id))?.messages, seat.messages);
  const bak = path.join(dataDir, 'cyclone', workshop.id, 'bak');
  await assert.rejects(fs.access(bak));
});

test('成功压缩后归档旧回合并保留摘要与最近三个完整回合', async (t) => {
  const { dataDir, workshop, seat, plan } = await fixture(t);
  const result = await applySeatCompaction(dataDir, workshop.id, seat, plan, '## Goal\n继续完成项目');
  const saved = await loadSeat(dataDir, workshop.id, seat.id);

  assert.equal(result.archivedCount, 2);
  assert.equal(saved?.messages.length, 7);
  assert.match(saved?.messages[0].content || '', /滚动压缩摘要/);
  assert.match(saved?.messages[0].content || '', /继续完成项目/);
  assert.deepEqual(saved?.messages.slice(1), plan.keptMessages);
  assert.equal(saved?.tokenUsage, undefined);
  assert.equal(saved?.compactState?.archiveSeq, 1);

  const archive = JSON.parse(await fs.readFile(result.archivePath, 'utf8'));
  assert.equal(archive.type, 'cyclone-seat-context-compact');
  assert.deepEqual(archive.messages, plan.archivedMessages);
  assert.equal(archive.keptTurnCount, 3);
});
