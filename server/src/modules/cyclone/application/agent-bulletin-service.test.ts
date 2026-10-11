import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyBulletinOps, readBulletinHistory } from '../../../engine/cyclone/bulletin.js';
import { CycloneWorkshopService } from './workshop-service.js';
import { CycloneAgentBulletinService } from './agent-bulletin-service.js';

test('Agent 公告仅追加并由可信执行身份署名，读取可分页且变更后旧游标失效', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-agent-bulletin-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshops = new CycloneWorkshopService(dataDir);
  const workshop = await workshops.create({ title: '工程组' });
  const service = new CycloneAgentBulletinService(dataDir, workshops);
  await service.post(workshop.id, '第一条', 'agent-a');
  await service.post(workshop.id, '第二条', 'agent-a');
  const first = await service.read(workshop.id, 1);
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0]?.author, 'Agent:agent-a');
  assert.ok(first.nextCursor);
  const second = await service.read(workshop.id, 1, first.nextCursor);
  assert.equal(second.items[0]?.text, '第二条');
  assert.equal((await readBulletinHistory(dataDir, workshop.id)).length, 2);
  await service.post(workshop.id, '第三条', 'agent-b');
  await assert.rejects(service.read(workshop.id, 1, first.nextCursor),
    hasCode('CYCLONE_BULLETIN_CHANGED'));
});

test('公告板满额时 Agent 追加明确失败，不伪报成功', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-agent-bulletin-full-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshops = new CycloneWorkshopService(dataDir);
  const workshop = await workshops.create({ title: '满额组' });
  await applyBulletinOps(dataDir, workshop.id,
    Array.from({ length: 60 }, (_, i) => ({ op: 'add' as const, text: `条目 ${i}` })), '人类');
  const service = new CycloneAgentBulletinService(dataDir, workshops);
  await assert.rejects(service.post(workshop.id, '第 61 条', 'agent-a'),
    hasCode('CYCLONE_BULLETIN_FULL'));
  assert.equal((await service.read(workshop.id, 60)).items.length, 60);
});

function hasCode(code: string) {
  return (error: unknown) => (error as { data?: { code?: string } }).data?.code === code;
}
