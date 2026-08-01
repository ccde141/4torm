import assert from 'node:assert/strict';
import test from 'node:test';
import { VisualArtifactStore } from './visual-artifact-store.js';

test('keeps only the latest frame for its owning execution', () => {
  const store = new VisualArtifactStore();
  store.publish('exec-a', 'image/png', Buffer.from('first'));
  store.publish('exec-a', 'image/png', Buffer.from('latest'));

  assert.equal(store.get('exec-a')?.data.toString(), 'latest');
});

test('does not expose a frame when its execution is not owner-authorized', () => {
  const store = new VisualArtifactStore();
  store.publish('exec-a', 'image/png', Buffer.from('frame'));

  assert.equal(store.get('exec-b'), undefined);
});
