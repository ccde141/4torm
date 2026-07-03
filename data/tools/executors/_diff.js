/**
 * 行级 unified diff（LCS）—— 供 edit_file / write_file 生成「原生 diff」内联进工具返回值，
 * 让 LLM 结构化看清自己改了什么（code review 用）。
 *
 * 与前端 src/utils/diff.ts 同源（同一套 LCS），此处额外做两件事：
 *   1. 折叠未改动区，只保留改动前后 context 行 → 输出 git 风格 `@@ -a,c +b,c @@` hunk，
 *      避免把整份文件当上下文塞进 token。
 *   2. 超大改动截断（MAX_LINES）/ 双侧都大时放弃 O(m×n)（MAX_CELLS）。
 * executor 是沙箱内独立 JS，不能 import src 下的 TS，故此处自带一份精简实现（对齐 _resolve.js 的约定）。
 */

const MAX_CELLS = 1_500_000; // 双侧都大才会触发 O(m×n) 爆炸
const MAX_LINES = 80;        // 内联进 LLM 结果的最大 diff 行数
const CONTEXT = 3;           // 每个 hunk 改动行上下保留的未改动行数

/** 逐行 LCS diff → [{ t: ' '|'+'|'-', s }] */
function lcsDiff(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ t: ' ', s: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: '-', s: a[i] }); i++; }
    else { out.push({ t: '+', s: b[j] }); j++; }
  }
  while (i < m) out.push({ t: '-', s: a[i++] });
  while (j < n) out.push({ t: '+', s: b[j++] });
  return out;
}

/**
 * 计算 before→after 的 unified diff 文本。
 * @param {string} before 旧内容（空串=新建/纯增）
 * @param {string} after  新内容
 * @param {string} label  文件路径（作为 ---/+++ 头）
 * @returns {{ text: string, add: number, del: number, tooLarge: boolean }}
 *          text 为可直接给 LLM 的 diff（无改动时为空串）。
 */
export function unifiedDiff(before, after, label) {
  const a = before && before.length ? before.split('\n') : [];
  const b = after && after.length ? after.split('\n') : [];
  if (a.length * b.length > MAX_CELLS) {
    return { text: `${label}：改动过大，省略逐行 diff（+${b.length} / -${a.length} 行）`, add: b.length, del: a.length, tooLarge: true };
  }

  const raw = lcsDiff(a, b);
  let add = 0, del = 0;
  for (const r of raw) { if (r.t === '+') add++; else if (r.t === '-') del++; }
  if (!add && !del) return { text: '', add: 0, del: 0, tooLarge: false };

  // 标注每行在 a/b 侧的 1-based 行号
  let ai = 0, bi = 0;
  const rows = raw.map(r => {
    if (r.t === ' ') { ai++; bi++; }
    else if (r.t === '-') { ai++; }
    else { bi++; }
    return { t: r.t, s: r.s, a: ai, b: bi };
  });

  // 改动行索引 → 按 context 合并成 hunk（间隔 ≤ 2*context 的合并为一个）
  const changed = [];
  rows.forEach((r, i) => { if (r.t !== ' ') changed.push(i); });
  const hunks = [];
  let s = Math.max(0, changed[0] - CONTEXT);
  let e = Math.min(rows.length - 1, changed[0] + CONTEXT);
  for (let k = 1; k < changed.length; k++) {
    const c = changed[k];
    if (c - CONTEXT <= e + 1) e = Math.min(rows.length - 1, c + CONTEXT);
    else { hunks.push([s, e]); s = Math.max(0, c - CONTEXT); e = Math.min(rows.length - 1, c + CONTEXT); }
  }
  hunks.push([s, e]);

  const lines = [];
  for (const [hs, he] of hunks) {
    const seg = rows.slice(hs, he + 1);
    const aSide = seg.filter(r => r.t !== '+');
    const bSide = seg.filter(r => r.t !== '-');
    const aStart = aSide.length ? aSide[0].a : seg[0].a;
    const bStart = bSide.length ? bSide[0].b : seg[0].b;
    lines.push(`@@ -${aStart},${aSide.length} +${bStart},${bSide.length} @@`);
    for (const r of seg) lines.push(r.t + r.s);
  }

  const truncated = lines.length > MAX_LINES;
  const body = (truncated ? lines.slice(0, MAX_LINES) : lines).join('\n');
  const tail = truncated ? `\n… diff 过长已截断（本文件共 +${add} / -${del} 行，需要全貌用 read_file）` : '';
  return { text: `--- ${label}\n+++ ${label}\n${body}${tail}`, add, del, tooLarge: false };
}
