import { describe, expect, it } from 'vitest';
import { computeDiffView, diffStat, lineDiff } from './diff';

describe('lineDiff', () => {
  it('keeps add/del direction on replacement', () => {
    const replace = lineDiff('a\nb\nc', 'a\nB\nc\nd');
    expect(replace.map(l => [l.type, l.text])).toEqual([
      ['ctx', 'a'],
      ['del', 'b'],
      ['add', 'B'],
      ['ctx', 'c'],
      ['add', 'd'],
    ]);
    expect(diffStat(replace)).toEqual({ add: 2, del: 1 });
  });

  it('treats empty before as all additions', () => {
    const newFile = lineDiff('', 'x\ny');
    expect(newFile.map(l => l.type)).toEqual(['add', 'add']);
  });
});

describe('computeDiffView', () => {
  it('returns real line diff for small inputs', () => {
    const view = computeDiffView('a\nb', 'a\nB');
    expect(view.tooLarge).toBe(false);
    if (!view.tooLarge) expect(view).toMatchObject({ add: 1, del: 1 });
  });

  it('falls back to a summary when both sides are large (avoids O(m×n) freeze)', () => {
    // 两侧各 ~2000 行 → 4,000,000 单元格，超过阈值，必须退回摘要而不是真跑 LCS
    const big = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n');
    const big2 = Array.from({ length: 2000 }, (_, i) => `LINE ${i}`).join('\n');
    const view = computeDiffView(big, big2);
    expect(view.tooLarge).toBe(true);
    expect(view).toMatchObject({ add: 2000, del: 2000 });
  });

  it('still diffs a large new file (one side empty → O(n))', () => {
    const big = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n');
    const view = computeDiffView('', big);
    expect(view.tooLarge).toBe(false);
  });
});
