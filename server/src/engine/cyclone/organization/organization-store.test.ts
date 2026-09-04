import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FrameworkError } from '../../shared/framework-error.js';
import { createWorkshop } from '../workshop-store.js';
import {
  loadWorkshopOrganization,
  saveWorkshopOrganization,
} from './organization-store.js';

async function fixture(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-org-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '组织测试' });
  workshop.seatIds = ['seat-a', 'seat-b', 'seat-c'];
  await fs.writeFile(
    path.join(dataDir, 'cyclone', workshop.id, 'meta.json'),
    JSON.stringify(workshop),
  );
  return { dataDir, workshop };
}

const validDraft = {
  groups: [
    {
      id: 'group-product', title: '产品组', seatIds: ['seat-a', 'seat-b'],
      position: { x: 20, y: 40 },
    },
    {
      id: 'group-engineering', title: '研发组', seatIds: ['seat-c'],
      position: { x: 420, y: 40 },
    },
  ],
  externalRelations: [
    {
      id: 'relation-a-c', sourceSeatId: 'seat-a', targetSeatId: 'seat-c',
      direction: 'both',
    },
  ],
};

function assertFrameworkError(error: unknown, code: string): boolean {
  assert.ok(error instanceof FrameworkError);
  assert.equal(error.data.code, code);
  return true;
}

test('没有组织文件的旧工作室保持自由协作且不自动写入', async (t) => {
  const { dataDir, workshop } = await fixture(t);

  const loaded = await loadWorkshopOrganization(dataDir, workshop.id);

  assert.deepEqual(loaded, { mode: 'legacy-full-mesh', organization: null });
  await assert.rejects(
    fs.access(path.join(dataDir, 'cyclone', workshop.id, 'organization.json')),
  );
});

test('首次保存从 revision 0 进入显式组织模式', async (t) => {
  const { dataDir, workshop } = await fixture(t);

  const saved = await saveWorkshopOrganization(dataDir, workshop.id, {
    expectedRevision: 0,
    ...validDraft,
  });

  assert.equal(saved.revision, 1);
  assert.equal(saved.version, 2);
  assert.match(saved.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(await loadWorkshopOrganization(dataDir, workshop.id), {
    mode: 'explicit', organization: saved,
  });
});

test('工位画布坐标可选保存并拒绝不存在工位的布局', async (t) => {
  const { dataDir, workshop } = await fixture(t);
  const saved = await saveWorkshopOrganization(dataDir, workshop.id, {
    expectedRevision: 0, ...validDraft,
    seatPositions: { 'seat-a': { x: 80, y: 120 }, 'seat-c': { x: 520, y: 160 } },
  });
  assert.deepEqual(saved.seatPositions, {
    'seat-a': { x: 80, y: 120 }, 'seat-c': { x: 520, y: 160 },
  });

  await assert.rejects(
    saveWorkshopOrganization(dataDir, workshop.id, {
      expectedRevision: 1, ...validDraft,
      seatPositions: { missing: { x: 0, y: 0 } },
    }),
    error => assertFrameworkError(error, 'CYCLONE_ORGANIZATION_INVALID'),
  );
});

test('脏组织关系在写盘前被拒绝', async (t) => {
  const { dataDir, workshop } = await fixture(t);
  const dirty = {
    expectedRevision: 0,
    groups: [
      ...validDraft.groups,
      {
        id: 'group-duplicate', title: '重复组', seatIds: ['seat-a'],
        position: { x: 0, y: 0 },
      },
    ],
    externalRelations: validDraft.externalRelations,
  };

  await assert.rejects(
    saveWorkshopOrganization(dataDir, workshop.id, dirty),
    error => assertFrameworkError(error, 'CYCLONE_ORGANIZATION_INVALID'),
  );
  assert.equal((await loadWorkshopOrganization(dataDir, workshop.id)).mode, 'legacy-full-mesh');
});

test('同一对工位不能保存两条关系且方向必须明确', async (t) => {
  const { dataDir, workshop } = await fixture(t);
  await assert.rejects(
    saveWorkshopOrganization(dataDir, workshop.id, {
      expectedRevision: 0,
      ...validDraft,
      externalRelations: [
        ...validDraft.externalRelations,
        { id: 'relation-c-a', sourceSeatId: 'seat-c', targetSeatId: 'seat-a', direction: 'forward' },
      ],
    }),
    error => assertFrameworkError(error, 'CYCLONE_ORGANIZATION_INVALID'),
  );
  await assert.rejects(
    saveWorkshopOrganization(dataDir, workshop.id, {
      expectedRevision: 0,
      ...validDraft,
      externalRelations: [{
        id: 'relation-a-c', sourceSeatId: 'seat-a', targetSeatId: 'seat-c', direction: 'contact-only',
      }],
    }),
    error => assertFrameworkError(error, 'CYCLONE_ORGANIZATION_INVALID'),
  );
});

test('expectedRevision 非整数时返回明确的版本校验错误', async (t) => {
  const { dataDir, workshop } = await fixture(t);

  await assert.rejects(
    saveWorkshopOrganization(dataDir, workshop.id, {
      ...validDraft, expectedRevision: '0' as unknown as number,
    }),
    (error) => {
      assertFrameworkError(error, 'CYCLONE_ORGANIZATION_INVALID');
      assert.match((error as FrameworkError).message, /expectedRevision/);
      return true;
    },
  );
});

test('同一 revision 的并发保存只能有一次成功', async (t) => {
  const { dataDir, workshop } = await fixture(t);
  const writes = await Promise.allSettled([
    saveWorkshopOrganization(dataDir, workshop.id, { expectedRevision: 0, ...validDraft }),
    saveWorkshopOrganization(dataDir, workshop.id, {
      expectedRevision: 0,
      ...validDraft,
      groups: validDraft.groups.map(group => ({ ...group, title: `${group.title} B` })),
    }),
  ]);

  assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = writes.find(result => result.status === 'rejected');
  assert.equal(rejected?.status, 'rejected');
  if (rejected?.status === 'rejected') {
    assertFrameworkError(rejected.reason, 'CYCLONE_ORGANIZATION_REVISION_CONFLICT');
  }
  assert.equal((await loadWorkshopOrganization(dataDir, workshop.id)).organization?.revision, 1);
});

test('损坏组织文件保留原文并真实报告，不回退成自由协作', async (t) => {
  const { dataDir, workshop } = await fixture(t);
  const file = path.join(dataDir, 'cyclone', workshop.id, 'organization.json');
  await fs.writeFile(file, '{ broken json', 'utf8');

  await assert.rejects(
    loadWorkshopOrganization(dataDir, workshop.id),
    error => assertFrameworkError(error, 'CYCLONE_ORGANIZATION_CORRUPT'),
  );
  assert.equal(await fs.readFile(file, 'utf8'), '{ broken json');
});

test('不存在的工作室不能伪装成旧版自由协作', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-org-missing-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  await assert.rejects(
    loadWorkshopOrganization(dataDir, 'missing'),
    error => assertFrameworkError(error, 'CYCLONE_WORKSHOP_NOT_FOUND'),
  );
});
