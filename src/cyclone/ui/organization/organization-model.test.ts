import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addGroup,
  assignSeatToGroup,
  assignSeatAndCleanRelations,
  createEditableOrganization,
  createExternalRelation,
  validateExternalRelation,
  reverseExternalRelation,
  removeGroup,
  rebaseEditableOrganization,
  reconcileOrganizationSeats,
} from './organization-model.js';

const seats = [
  { id: 'seat-a', title: '产品' },
  { id: 'seat-b', title: '设计' },
  { id: 'seat-c', title: '开发' },
];

test('旧版工作室只生成本地布局草稿，不伪造显式组织', () => {
  const draft = createEditableOrganization({
    mode: 'legacy-full-mesh', organization: null,
  }, seats);

  assert.equal(draft.baseRevision, 0);
  assert.equal(draft.activatesExplicitMode, true);
  assert.deepEqual(draft.groups, []);
  assert.deepEqual(Object.keys(draft.seatPositions), seats.map(seat => seat.id));
});

test('绘图区已打开后连续新增工位会补入互不重叠的草稿坐标', () => {
  const initial = createEditableOrganization({
    mode: 'explicit',
    organization: {
      version: 2, revision: 1, groups: [], externalRelations: [],
      seatPositions: { 'seat-a': { x: 80, y: 90 } }, updatedAt: '2026-09-04T00:00:00.000Z',
    },
  }, [seats[0]]);
  const next = reconcileOrganizationSeats(initial, seats);
  assert.deepEqual(next.seatPositions['seat-a'], { x: 80, y: 90 });
  assert.ok(next.seatPositions['seat-b']);
  assert.ok(next.seatPositions['seat-c']);
  assert.notDeepEqual(next.seatPositions['seat-b'], next.seatPositions['seat-c']);
  assert.equal(reconcileOrganizationSeats(next, seats), next);
});

test('删除工位后从组织草稿清理组成员、联络线与布局', () => {
  const draft = {
    baseRevision: 1, activatesExplicitMode: false,
    groups: [{ id: 'a', title: 'A', seatIds: ['seat-a', 'seat-b'], position: { x: 0, y: 0 } }],
    externalRelations: [{ id: 'ab', sourceSeatId: 'seat-a', targetSeatId: 'seat-b', direction: 'both' as const }],
    seatPositions: { 'seat-a': { x: 80, y: 90 }, 'seat-b': { x: 330, y: 90 } },
  };

  const next = reconcileOrganizationSeats(draft, [seats[0]]);

  assert.deepEqual(next.groups[0].seatIds, ['seat-a']);
  assert.deepEqual(next.externalRelations, []);
  assert.deepEqual(next.seatPositions, { 'seat-a': { x: 80, y: 90 } });
});

test('服务端删除工位提升版本后重基草稿并保留其余未保存编辑', () => {
  const draft = {
    baseRevision: 1, activatesExplicitMode: false,
    groups: [{ id: 'a', title: '未保存的新组名', seatIds: ['seat-a', 'seat-b'], position: { x: 20, y: 30 } }],
    externalRelations: [],
    seatPositions: { 'seat-a': { x: 200, y: 210 }, 'seat-b': { x: 330, y: 90 } },
  };
  const state = {
    mode: 'explicit' as const,
    organization: {
      version: 2 as const, revision: 2, updatedAt: '2026-09-04T00:00:00.000Z',
      groups: [{ id: 'a', title: '旧组名', seatIds: ['seat-a'], position: { x: 0, y: 0 } }],
      externalRelations: [], seatPositions: { 'seat-a': { x: 80, y: 90 } },
    },
  };

  const next = rebaseEditableOrganization(draft, state, [seats[0]]);

  assert.equal(next.baseRevision, 2);
  assert.equal(next.groups[0].title, '未保存的新组名');
  assert.deepEqual(next.groups[0].seatIds, ['seat-a']);
  assert.deepEqual(next.seatPositions['seat-a'], { x: 200, y: 210 });
});

test('工位进入新组时自动退出旧组', () => {
  const groups = [
    { id: 'a', title: 'A', seatIds: ['seat-a'], position: { x: 0, y: 0 } },
    { id: 'b', title: 'B', seatIds: ['seat-b'], position: { x: 400, y: 0 } },
  ];

  const next = assignSeatToGroup(groups, 'seat-a', 'b');

  assert.deepEqual(next.map(group => group.seatIds), [[], ['seat-b', 'seat-a']]);
});

test('删除协作组只解除集合，不删除工位', () => {
  const groups = [
    { id: 'a', title: 'A', seatIds: ['seat-a'], position: { x: 0, y: 0 } },
    { id: 'b', title: 'B', seatIds: ['seat-b'], position: { x: 400, y: 0 } },
  ];

  assert.deepEqual(removeGroup(groups, 'a').map(group => group.id), ['b']);
});

test('从画布空白处创建协作组时使用缩放换算后的坐标', () => {
  const [group] = addGroup([], 0, { x: 480, y: 260 });
  assert.deepEqual(group.position, { x: 480, y: 260 });
});

test('跨组连线默认双向协作且同一对工位只能有一条关系', () => {
  const groups = [
    { id: 'a', title: 'A', seatIds: ['seat-a', 'seat-b'], position: { x: 0, y: 0 } },
    { id: 'b', title: 'B', seatIds: ['seat-c'], position: { x: 400, y: 0 } },
  ];
  const first = createExternalRelation([], groups, 'seat-a', 'seat-c');
  assert.equal(first.length, 1);
  assert.equal(first[0].direction, 'both');
  assert.throws(() => createExternalRelation(first, groups, 'seat-a', 'seat-c'), /已经存在/);
  assert.throws(() => createExternalRelation(first, groups, 'seat-c', 'seat-a'), /已经存在/);
  assert.throws(() => createExternalRelation(first, groups, 'seat-a', 'seat-b'), /同组/);
  assert.match(validateExternalRelation(first, groups, 'seat-c', 'seat-a') ?? '', /已经存在/);
  assert.match(validateExternalRelation(first, groups, 'seat-a', 'seat-a') ?? '', /自身/);
  assert.equal(validateExternalRelation([], groups, 'seat-a', 'seat-c'), null);
});

test('单向关系翻转只交换端点并保持关系 id', () => {
  const relation = { id: 'ab', sourceSeatId: 'seat-a', targetSeatId: 'seat-b', direction: 'forward' as const };
  assert.deepEqual(reverseExternalRelation(relation), {
    id: 'ab', sourceSeatId: 'seat-b', targetSeatId: 'seat-a', direction: 'forward',
  });
});

test('工位移入目标组时清理因此变成同组的外连', () => {
  const draft = {
    baseRevision: 1, activatesExplicitMode: false, seatPositions: {},
    groups: [
      { id: 'a', title: 'A', seatIds: ['seat-a'], position: { x: 0, y: 0 } },
      { id: 'b', title: 'B', seatIds: ['seat-b'], position: { x: 400, y: 0 } },
    ],
    externalRelations: [{ id: 'ab', sourceSeatId: 'seat-a', targetSeatId: 'seat-b', direction: 'both' as const }],
  };
  const next = assignSeatAndCleanRelations(draft, 'seat-a', 'b');
  assert.deepEqual(next.groups.map(group => group.seatIds), [[], ['seat-b', 'seat-a']]);
  assert.deepEqual(next.externalRelations, []);
});
