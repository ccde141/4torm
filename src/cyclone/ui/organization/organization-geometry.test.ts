import assert from 'node:assert/strict';
import test from 'node:test';
import { findContainingGroup } from './organization-geometry';

const groups = [
  { id: 'left', title: '左组', seatIds: [], position: { x: 20, y: 30 }, size: { width: 300, height: 200 } },
  { id: 'right', title: '右组', seatIds: [], position: { x: 400, y: 30 }, size: { width: 300, height: 200 } },
];

test('工位归组按实际卡片中心判断而不是旧卡片偏移量', () => {
  assert.equal(findContainingGroup(groups, { x: 210, y: 60 }, { width: 210, height: 110 })?.id, 'left');
  assert.equal(findContainingGroup(groups, { x: 250, y: 60 }, { width: 210, height: 110 }), undefined);
});

test('协作组边界包含落在边缘上的工位中心', () => {
  assert.equal(findContainingGroup(groups, { x: 295, y: 175 }, { width: 50, height: 50 })?.id, 'left');
});
