import assert from 'node:assert/strict';
import test from 'node:test';
import { selectionAfterProviderRemoval } from './provider-workspace-state.js';

const providers = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

test('removing the selected provider selects its next neighbor, then its previous neighbor', () => {
  assert.equal(selectionAfterProviderRemoval(providers, 'b', 'b'), 'c');
  assert.equal(selectionAfterProviderRemoval(providers, 'c', 'c'), 'b');
  assert.equal(selectionAfterProviderRemoval([{ id: 'a' }], 'a', 'a'), null);
});

test('removing another provider preserves the current selection', () => {
  assert.equal(selectionAfterProviderRemoval(providers, 'b', 'a'), 'b');
});
