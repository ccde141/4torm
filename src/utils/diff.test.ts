import assert from 'node:assert/strict';
import test from 'node:test';
import { computeDiffView, diffStat, lineDiff } from './diff';

test('lineDiff keeps add/del direction on replacement', () => {
  const replace = lineDiff('a\nb\nc', 'a\nB\nc\nd');
  assert.deepEqual(replace.map(line => [line.type, line.text]), [
    ['ctx', 'a'],
    ['del', 'b'],
    ['add', 'B'],
    ['ctx', 'c'],
    ['add', 'd'],
  ]);
  assert.deepEqual(diffStat(replace), { add: 2, del: 1 });
});

test('lineDiff treats empty before as all additions', () => {
  const newFile = lineDiff('', 'x\ny');
  assert.deepEqual(newFile.map(line => line.type), ['add', 'add']);
});

test('computeDiffView returns real line diff for small inputs', () => {
  const view = computeDiffView('a\nb', 'a\nB');
  assert.equal(view.tooLarge, false);
  if (!view.tooLarge) assert.deepEqual({ add: view.add, del: view.del }, { add: 1, del: 1 });
});

test('computeDiffView falls back to a summary for two large inputs', () => {
  const big = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n');
  const big2 = Array.from({ length: 2000 }, (_, i) => `LINE ${i}`).join('\n');
  const view = computeDiffView(big, big2);
  assert.equal(view.tooLarge, true);
  assert.deepEqual({ add: view.add, del: view.del }, { add: 2000, del: 2000 });
});

test('computeDiffView still diffs a large new file', () => {
  const big = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n');
  const view = computeDiffView('', big);
  assert.equal(view.tooLarge, false);
});
