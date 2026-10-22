import assert from 'node:assert/strict';
import test from 'node:test';
import { computeDiffView, diffStat, lineDiff } from './diff';

function assertSummary(before: string, after: string, add: number, del: number) {
  const view = computeDiffView(before, after);
  assert.equal(view.tooLarge, true);
  assert.deepEqual({ add: view.add, del: view.del }, { add, del });
}

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

test('computeDiffView bounds single-sided line-heavy files before creating rows', () => {
  const manyLines = 'row\n'.repeat(10_000);
  assertSummary('', manyLines, 10_001, 0);
  assertSummary(manyLines, '', 0, 10_001);
});

test('computeDiffView bounds very long lines even when the LCS matrix is small', () => {
  const longLine = 'x'.repeat(256_001);
  assertSummary('', longLine, 1, 0);
  assertSummary(longLine, 'replacement\n', 2, 1);
});

test('computeDiffView applies its character budget to both versions together', () => {
  const before = 'x'.repeat(128_001);
  const after = 'y'.repeat(128_001);
  assertSummary(before, after, 1, 1);
});
