import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveOrganizationSaveState } from './organization-save-state';

const draft = {
  baseRevision: 1,
  activatesExplicitMode: false,
  groups: [],
  externalRelations: [],
  seatPositions: {},
};

test('首次启用显式协作边界即使尚未移动画布也必须保存', () => {
  const activationDraft = { ...draft, activatesExplicitMode: true };
  assert.equal(deriveOrganizationSaveState(activationDraft, activationDraft, false), 'unsaved');
});

test('保存状态区分未保存、保存中与已保存', () => {
  assert.equal(deriveOrganizationSaveState({ ...draft }, draft, false), 'unsaved');
  assert.equal(deriveOrganizationSaveState(draft, draft, true), 'saving');
  assert.equal(deriveOrganizationSaveState(draft, draft, false), 'saved');
});
