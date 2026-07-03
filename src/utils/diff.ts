/**
 * 行级 diff（LCS）——用于把 AI 的文件改动可视化成红/绿差异。
 *
 * 纯前端、纯函数，不引第三方库。edit_file 的 oldString/newString 本就在工具参数里，
 * write_file 只有新内容（旧内容未知）时按全新增处理，before 传空串即可。
 */

export type DiffLine = { type: 'add' | 'del' | 'ctx'; text: string };

/** 计算 before→after 的逐行差异。before/after 为空串时分别退化为纯删/纯增。 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.length ? before.split('\n') : [];
  const b = after.length ? after.split('\n') : [];
  const m = a.length, n = b.length;

  // LCS 长度表：dp[i][j] = a[i..] 与 b[j..] 的最长公共子序列长度
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ type: 'ctx', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: a[i] }); i++; }
    else { out.push({ type: 'add', text: b[j] }); j++; }
  }
  while (i < m) out.push({ type: 'del', text: a[i++] });
  while (j < n) out.push({ type: 'add', text: b[j++] });
  return out;
}

/** 统计增删行数。 */
export function diffStat(lines: DiffLine[]): { add: number; del: number } {
  let add = 0, del = 0;
  for (const l of lines) {
    if (l.type === 'add') add++;
    else if (l.type === 'del') del++;
  }
  return { add, del };
}

/**
 * LCS 是 O(m×n)：两侧都很大的覆盖写入会分配巨大矩阵、冻结渲染。
 * 超过此单元格上限（约 1200×1200）就放弃逐行对齐，退回「整体替换」的廉价展示。
 */
const MAX_DIFF_CELLS = 1_500_000;

export type DiffView =
  | { tooLarge: false; lines: DiffLine[]; add: number; del: number }
  | { tooLarge: true; add: number; del: number };

/** 计算可安全渲染的 diff 视图：小改动做真实行级 diff，大文件退回替换摘要。 */
export function computeDiffView(before: string, after: string): DiffView {
  const aLen = before.length ? before.split('\n').length : 0;
  const bLen = after.length ? after.split('\n').length : 0;
  // 双侧都大才会触发 O(m×n) 爆炸；新建/纯增（一侧为 0）仍走真实 diff（退化为 O(n)）
  if (aLen * bLen > MAX_DIFF_CELLS) {
    return { tooLarge: true, add: bLen, del: aLen };
  }
  const lines = lineDiff(before, after);
  const { add, del } = diffStat(lines);
  return { tooLarge: false, lines, add, del };
}
