import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditableOrganization, reconcileOrganizationSeats } from './organization-model';
import { hasOrganizationEdits, synchronizeOrganizationDraft } from './organization-sync';

const seats = [{ id: 'a', agentId: 'agent', title: '需求' }, { id: 'b', agentId: 'agent', title: '撰稿' }];
function fixture() {
  const saved = createEditableOrganization({ mode: 'legacy-full-mesh', organization: null }, seats.slice(0, 1));
  const draft = reconcileOrganizationSeats(saved, seats);
  const authoritative = createEditableOrganization({ mode: 'explicit', organization: { version: 2,
    revision: 1, updatedAt: '2026-10-28T00:00:00Z', groups: [{ id: 'g', title: '交付',
      seatIds: ['a', 'b'], position: { x: 0, y: 0 } }], externalRelations: [] } }, seats);
  return { saved, draft, authoritative };
}
test('自动新增工位布局不阻止 Agent 的服务端分组进入画布', () => {
  const { saved, draft, authoritative } = fixture();
  assert.notEqual(saved, draft);
  const result = synchronizeOrganizationDraft(draft, saved, authoritative, seats);
  assert.equal(result.conflict, false); assert.equal(result.draft, authoritative);
  assert.equal(result.draft.activatesExplicitMode, false); assert.equal(result.draft.groups.length, 1);
});
test('人类移动工位后保留未保存内容与旧版本，不静默覆盖或自动提高写入版本', () => {
  const { saved, draft, authoritative } = fixture();
  const changed = { ...draft, seatPositions: { ...draft.seatPositions, a: { x: 999, y: 999 } } };
  const result = synchronizeOrganizationDraft(changed, saved, authoritative, seats);
  assert.equal(result.conflict, true); assert.equal(result.draft, changed); assert.equal(result.draft.baseRevision, 0);
});
test('自动删除成员与纯对象复制不构成人类编辑；真正的分组修改构成编辑', () => {
  const { authoritative } = fixture();
  assert.equal(hasOrganizationEdits(structuredClone(authoritative), authoritative), false);
  const pruned = reconcileOrganizationSeats(authoritative, seats.slice(0, 1));
  assert.equal(hasOrganizationEdits(pruned, authoritative, seats.slice(0, 1)), false);
  assert.equal(hasOrganizationEdits({ ...authoritative, groups: [] }, authoritative), true);
});
