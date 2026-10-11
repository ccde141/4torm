import assert from 'node:assert/strict';
import test from 'node:test';
import { messagePageOffsets } from './message-page.js';

test('long message pages preserve every character without splitting a surrogate pair', () => {
  const source = `${'a'.repeat(16_383)}🙂${'b'.repeat(40_000)}`;
  const offsets = messagePageOffsets(source, 16_384);
  const pages = offsets.slice(0, -1).map((start, index) => source.slice(start, offsets[index + 1]));
  assert.equal(pages.join(''), source);
  assert.equal(pages[0]?.length, 16_383);
  assert.equal(pages[1]?.startsWith('🙂'), true);
  assert.equal(pages.every(page => page.length <= 16_384), true);
});

test('page boundaries prefer a nearby line break so reading resumes at a new line', () => {
  const source = 'line\n'.repeat(100);
  const offsets = messagePageOffsets(source, 18);
  assert.equal(offsets[1], 15);
  assert.equal(source.slice(offsets[1]).startsWith('line\n'), true);
  assert.equal(offsets.slice(0, -1).map((start, index) =>
    source.slice(start, offsets[index + 1])).join(''), source);
});
