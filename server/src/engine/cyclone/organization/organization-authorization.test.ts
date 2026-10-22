import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FrameworkError } from '../../shared/framework-error.js';
import { addSeat, saveSeat } from '../seat-store.js';
import { createWorkshop } from '../workshop-store.js';
import {
  listAuthorizedTargets,
  resolveAuthorizedTarget,
} from './organization-authorization.js';
import { saveWorkshopOrganization } from './organization-store.js';

async function fixture(t: test.TestContext, explicit = true) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-auth-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '授权测试' });
  const a = await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: '产品', duty: '定义需求' });
  const b = await addSeat(dataDir, workshop.id, { agentId: 'agent-b', title: '设计', duty: '设计体验' });
  const c = await addSeat(dataDir, workshop.id, { agentId: 'agent-c', title: '开发', duty: '实现功能' });
  const d = await addSeat(dataDir, workshop.id, { agentId: 'agent-d', title: '审计', duty: '独立审计' });
  if (explicit) {
    await saveWorkshopOrganization(dataDir, workshop.id, {
      expectedRevision: 0,
      groups: [
        {
          id: 'product', title: '产品组', seatIds: [a.id, b.id],
          position: { x: 0, y: 0 },
        },
        {
          id: 'engineering', title: '研发组', seatIds: [c.id],
          position: { x: 400, y: 0 },
        },
      ],
      externalRelations: [
        {
          id: 'a-to-c', sourceSeatId: a.id, targetSeatId: c.id,
          direction: 'both',
        },
        {
          id: 'c-to-d', sourceSeatId: c.id, targetSeatId: d.id,
          direction: 'forward',
        },
      ],
    });
  }
  return { dataDir, workshop, a, b, c, d };
}

function titles(targets: Array<{ title: string }>): string[] {
  return targets.map(target => target.title).sort();
}

function assertCode(error: unknown, code: string): boolean {
  assert.ok(error instanceof FrameworkError);
  assert.equal(error.data.code, code);
  return true;
}

test('遗留同名工位拒绝歧义寻址，并允许用工位 ID 保持授权寻址', async t => {
  const { dataDir, workshop, a, b, c } = await fixture(t, false);
  c.title = b.title;
  await saveSeat(dataDir, workshop.id, c);
  await assert.rejects(resolveAuthorizedTarget(dataDir, workshop.id, a.id, b.title, 'contact'),
    error => assertCode(error, 'CYCLONE_TARGET_SEAT_AMBIGUOUS'));
  assert.equal((await resolveAuthorizedTarget(dataDir, workshop.id, a.id, c.id, 'contact')).id, c.id);
});

test('同组和双向外连同时开放 contact 与 dispatch', async (t) => {
  const { dataDir, workshop, a, b, c, d } = await fixture(t);

  for (const capability of ['contact', 'dispatch'] as const) {
    assert.deepEqual(titles(await listAuthorizedTargets(
      dataDir, workshop.id, a.id, capability,
    )), ['开发', '设计']);
    assert.deepEqual(titles(await listAuthorizedTargets(
      dataDir, workshop.id, b.id, capability,
    )), ['产品']);
    assert.deepEqual(titles(await listAuthorizedTargets(
      dataDir, workshop.id, c.id, capability,
    )), ['产品', '审计']);
    assert.deepEqual(titles(await listAuthorizedTargets(
      dataDir, workshop.id, d.id, capability,
    )), []);
  }
});

test('未分组工位没有隐式关系', async (t) => {
  const { dataDir, workshop, d } = await fixture(t);

  assert.deepEqual(await listAuthorizedTargets(dataDir, workshop.id, d.id, 'contact'), []);
  assert.deepEqual(await listAuthorizedTargets(dataDir, workshop.id, d.id, 'dispatch'), []);
});

test('执行入口区分目标不存在与关系拒绝', async (t) => {
  const { dataDir, workshop, a, d } = await fixture(t);

  await assert.rejects(
    resolveAuthorizedTarget(dataDir, workshop.id, a.id, '未知', 'contact'),
    error => assertCode(error, 'CYCLONE_TARGET_SEAT_NOT_FOUND'),
  );
  await assert.rejects(
    resolveAuthorizedTarget(dataDir, workshop.id, a.id, '审计', 'contact'),
    error => assertCode(error, 'CYCLONE_RELATION_DENIED'),
  );
  await assert.rejects(
    resolveAuthorizedTarget(dataDir, workshop.id, d.id, '开发', 'dispatch'),
    error => assertCode(error, 'CYCLONE_RELATION_DENIED'),
  );
});

test('群聊副本只能通过显式选项派回自己的固定工位', async (t) => {
  const { dataDir, workshop, a } = await fixture(t);

  await assert.rejects(
    resolveAuthorizedTarget(dataDir, workshop.id, a.id, a.title, 'dispatch'),
    error => assertCode(error, 'CYCLONE_RELATION_DENIED'),
  );
  assert.equal((await resolveAuthorizedTarget(
    dataDir, workshop.id, a.id, a.title, 'dispatch', { allowSelf: true },
  )).id, a.id);
});

test('旧工作室继续允许全部其他工位并保留群聊自派发', async (t) => {
  const { dataDir, workshop, a } = await fixture(t, false);

  assert.deepEqual(titles(await listAuthorizedTargets(
    dataDir, workshop.id, a.id, 'contact',
  )), ['审计', '开发', '设计']);
  assert.deepEqual(titles(await listAuthorizedTargets(
    dataDir, workshop.id, a.id, 'dispatch', { includeSelf: true },
  )), ['产品', '审计', '开发', '设计']);
});
