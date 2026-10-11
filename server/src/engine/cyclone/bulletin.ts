/**
 * 气旋工作室公告板 —— 工作室级共享看板（全体工位可见，人与工位皆可写）
 *
 * 结构化存储：按「条目」组织，支持增量读写（add/update/remove）。
 *
 * - 落盘：data/cyclone/{id}/bulletin.json = { entries: BulletinEntry[], updatedAt }
 * - 注入：每个工位 system prompt 里列出条目（buildBulletinSection），带变更注意力标记
 * - 假工具 bulletin：与 task_board 同级，服务端 inline 执行，各引擎 toolCaller 按名拦截
 * - 变更注意力：每条目带 updatedAt；工位私聊带 seenAt → 标 🆕 提示"自你上次以来的变动"
 *
 * 依赖边界：只 import node 内置 + 气旋路径/持久化，不 import 别的引擎。
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import {
  workshopBulletinFile, workshopBulletinHistoryFile, workshopBulletinPendingFile,
} from './paths';
import {
  commitCyclonePair, recoverCyclonePair, recoverCyclonePairSync, serializeCycloneFile,
  emptyBulletin, genEntryId, MAX_ENTRIES, MAX_TEXT,
  parseBulletin as parse, parseBulletinHistory as parseHistory,
} from './bulletin-persistence.js';
import { notifyBulletinChange } from './bulletin-change-listeners.js';
export { subscribeBulletinChanges } from './bulletin-change-listeners.js';

export interface BulletinEntry {
  id: string;
  text: string;
  /** 最后写入者：'人类' 或 工位 title */
  author: string;
  updatedAt: number;
}
export interface Bulletin {
  entries: BulletinEntry[];
  /** 最后一次任何变更的时间（0 = 空/从未） */
  updatedAt: number;
}

export type BulletinOp =
  | { op: 'add'; text: string; author?: string }
  | { op: 'update'; id: string; text: string; author?: string }
  | { op: 'remove'; id: string }
  | { op: 'restore'; id: string; text: string; author?: string };   // 按原 id 恢复（撤回删除用）

/** 一条改动记录（审计时间轴 + 撤回依据）。before→after 描述条目状态迁移 */
export interface BulletinChange {
  seq: number;
  ts: number;
  /** 谁做的这次改动（人='人类'，工位=title，撤回者='人类'） */
  actor: string;
  kind: 'add' | 'update' | 'remove' | 'restore' | 'revert';
  entryId: string;
  before: { text: string; author: string } | null;
  after: { text: string; author: string } | null;
  /** 若本次是撤回，指向被撤回的 seq */
  revertOf?: number;
}

const MAX_HISTORY = 200;

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

export function readBulletinSync(dataDir: string, workshopId: string): Bulletin {
  const [pending, board, history] = pairFiles(dataDir, workshopId);
  recoverCyclonePairSync(pending, board, history, validatePair);
  let raw: string;
  try { raw = fs.readFileSync(workshopBulletinFile(dataDir, workshopId), 'utf-8'); }
  catch (error) { if (isMissing(error)) return emptyBulletin(); throw error; }
  return parse(raw);
}

export async function readBulletin(dataDir: string, workshopId: string): Promise<Bulletin> {
  return serializeCycloneFile(workshopBulletinFile(dataDir, workshopId), async () => {
    await recoverPending(dataDir, workshopId);
    return readBulletinRaw(dataDir, workshopId);
  });
}

async function readBulletinRaw(dataDir: string, workshopId: string): Promise<Bulletin> {
  let raw: string;
  try { raw = await fsp.readFile(workshopBulletinFile(dataDir, workshopId), 'utf-8'); }
  catch (error) { if (isMissing(error)) return emptyBulletin(); throw error; }
  return parse(raw);
}

// ── 改动时间轴 ────────────────────────────────────────────────

export async function readBulletinHistory(dataDir: string, workshopId: string): Promise<BulletinChange[]> {
  return serializeCycloneFile(workshopBulletinFile(dataDir, workshopId), async () => {
    await recoverPending(dataDir, workshopId);
    return readHistoryRaw(dataDir, workshopId);
  });
}

async function readHistoryRaw(dataDir: string, workshopId: string): Promise<BulletinChange[]> {
  let raw: string;
  try { raw = await fsp.readFile(workshopBulletinHistoryFile(dataDir, workshopId), 'utf-8'); }
  catch (error) { if (isMissing(error)) return []; throw error; }
  return parseHistory(raw);
}

/**
 * 读取公告板，逐条应用操作，再原子写回文件。
 * 每条生效的 op 追加一条改动记录到时间轴（审计 + 撤回依据）。
 * @param defaultAuthor 操作的执行者落款（工位 title 或 '人类'）
 * @param revertOf 若本批是某次撤回产生的，指向被撤回的 seq（记录 kind 标为 'revert'）
 */
export async function applyBulletinOps(
  dataDir: string, workshopId: string, ops: BulletinOp[], defaultAuthor: string, revertOf?: number,
): Promise<Bulletin> {
  return serializeCycloneFile(workshopBulletinFile(dataDir, workshopId),
    () => applyBulletinOpsUnlocked(dataDir, workshopId, ops, defaultAuthor, revertOf));
}

async function applyBulletinOpsUnlocked(
  dataDir: string, workshopId: string, ops: BulletinOp[], defaultAuthor: string, revertOf?: number,
): Promise<Bulletin> {
  await recoverPending(dataDir, workshopId);
  const b = await readBulletinRaw(dataDir, workshopId);
  const now = Date.now();
  const recorded: Array<Pick<BulletinChange, 'kind' | 'entryId' | 'before' | 'after'>> = [];
  for (const op of ops) {
    if (op.op === 'add' || op.op === 'restore') {
      const text = String(op.text ?? '').trim().slice(0, MAX_TEXT);
      if (!text || b.entries.length >= MAX_ENTRIES) continue;
      if (op.op === 'restore' && b.entries.some(e => e.id === op.id)) continue;   // 已存在，别重复恢复
      const id = op.op === 'restore' ? op.id : genEntryId();
      const author = op.author || defaultAuthor;
      b.entries.push({ id, text, author, updatedAt: now });
      recorded.push({ kind: op.op, entryId: id, before: null, after: { text, author } });
    } else if (op.op === 'update') {
      const e = b.entries.find(x => x.id === op.id);
      const text = String(op.text ?? '').trim().slice(0, MAX_TEXT);
      if (!e || !text) continue;
      const before = { text: e.text, author: e.author };
      e.text = text; e.author = op.author || defaultAuthor; e.updatedAt = now;
      recorded.push({ kind: 'update', entryId: e.id, before, after: { text: e.text, author: e.author } });
    } else if (op.op === 'remove') {
      const i = b.entries.findIndex(x => x.id === op.id);
      if (i < 0) continue;
      const e = b.entries[i];
      const before = { text: e.text, author: e.author };
      b.entries.splice(i, 1);
      recorded.push({ kind: 'remove', entryId: e.id, before, after: null });
    }
  }
  if (recorded.length) {
    const hist = await readHistoryRaw(dataDir, workshopId);
    b.updatedAt = now;
    let seq = hist.length ? hist[hist.length - 1].seq : 0;
    for (const r of recorded) {
      seq++;
      hist.push({
        seq, ts: now, actor: defaultAuthor,
        kind: revertOf != null ? 'revert' : r.kind,
        entryId: r.entryId, before: r.before, after: r.after,
        ...(revertOf != null ? { revertOf } : {}),
      });
    }
    await commitBulletin(dataDir, workshopId, b, hist);
  }
  return b;
}

/**
 * 撤回某条改动：算出把该条目从 after 拉回 before 的逆操作，作为一次新的正向变更落库。
 * 历史 append-only 不篡改；撤回本身也记一条（kind='revert'），故可被再撤回。
 */
export async function revertBulletinChange(
  dataDir: string, workshopId: string, seq: number, actor: string,
): Promise<Bulletin> {
  return serializeCycloneFile(workshopBulletinFile(dataDir, workshopId),
    () => revertBulletinChangeUnlocked(dataDir, workshopId, seq, actor));
}

async function revertBulletinChangeUnlocked(
  dataDir: string, workshopId: string, seq: number, actor: string,
): Promise<Bulletin> {
  await recoverPending(dataDir, workshopId);
  const hist = await readHistoryRaw(dataDir, workshopId);
  const c = hist.find(x => x.seq === seq);
  if (!c) return readBulletinRaw(dataDir, workshopId);

  const cur = await readBulletinRaw(dataDir, workshopId);
  const exists = cur.entries.some(e => e.id === c.entryId);

  let op: BulletinOp | null = null;
  if (c.before == null && c.after != null) {
    op = { op: 'remove', id: c.entryId };                                             // 曾新增 → 删
  } else if (c.before != null && c.after == null) {
    op = { op: 'restore', id: c.entryId, text: c.before.text, author: c.before.author }; // 曾删除 → 恢复
  } else if (c.before != null && c.after != null) {
    op = exists                                                                        // 曾改写 → 改回 before
      ? { op: 'update', id: c.entryId, text: c.before.text, author: c.before.author }
      : { op: 'restore', id: c.entryId, text: c.before.text, author: c.before.author };
  }
  if (!op) return cur;
  return applyBulletinOpsUnlocked(dataDir, workshopId, [op], actor, seq);
}

function pairFiles(dataDir: string, workshopId: string): [string, string, string] {
  return [workshopBulletinPendingFile(dataDir, workshopId),
    workshopBulletinFile(dataDir, workshopId), workshopBulletinHistoryFile(dataDir, workshopId)];
}

function validatePair(board: string, history: string): void {
  parse(board);
  parseHistory(history);
}

function recoverPending(dataDir: string, workshopId: string): Promise<void> {
  const [pending, board, history] = pairFiles(dataDir, workshopId);
  return recoverCyclonePair(pending, board, history, validatePair);
}

async function commitBulletin(
  dataDir: string, workshopId: string, board: Bulletin, changes: BulletinChange[],
): Promise<void> {
  const [pending, boardFile, historyFile] = pairFiles(dataDir, workshopId);
  await commitCyclonePair(pending, boardFile, historyFile,
    JSON.stringify(board, null, 2), JSON.stringify({ changes: changes.slice(-MAX_HISTORY) }, null, 2));
  notifyBulletinChange(dataDir, workshopId);
}

function summarize(b: Bulletin): string {
  if (!b.entries.length) return '（公告板为空）';
  return b.entries.map(e => `- [${e.id}] ${e.text} (by ${e.author})`).join('\n');
}

/**
 * 假工具 bulletin 的服务端执行。Agent 仅可 get / add；旧 update/remove 调用明确拒绝。
 * 返回 result 进 LLM，meta 走 UI 侧通道。
 */
export async function execBulletin(
  dataDir: string, workshopId: string, args: Record<string, any>, author: string,
): Promise<{ result: string; ok: boolean; meta: { bulletin: Bulletin } }> {
  const action = args.action || 'get';

  if (action === 'get') {
    const b = await readBulletin(dataDir, workshopId);
    return { result: summarize(b), ok: true, meta: { bulletin: b } };
  }
  if (action === 'add') {
    if (!String(args.text ?? '').trim()) {
      const b = await readBulletin(dataDir, workshopId);
      return { result: 'bulletin add 需要非空 text。', ok: false, meta: { bulletin: b } };
    }
    const b = await applyBulletinOps(dataDir, workshopId, [{ op: 'add', text: args.text, author }], author);
    return { result: `已新增公告条目。当前公告板：\n${summarize(b)}`, ok: true, meta: { bulletin: b } };
  }
  const b = await readBulletin(dataDir, workshopId);
  const result = action === 'update' || action === 'remove'
    ? `bulletin ${action} 已拒绝：改写和删除仅人类可执行。可用 get / add。`
    : `未知 action：${action}（可用 get / add）`;
  return { result, ok: false, meta: { bulletin: b } };
}

/**
 * system prompt 片段：列出公告条目 + 变更注意力 + bulletin 工具用法。
 * @param opts.seenAt 本工位上次已读到的板子 updatedAt；晚于它的条目标 🆕（省略=不做增量标记）
 * @param opts.readOnly 只读视图（如会长）：不教 bulletin 工具，改为只读提示
 */
export function buildBulletinSection(b: Bulletin, opts?: { seenAt?: number; readOnly?: boolean }): string {
  const seenAt = opts?.seenAt;
  const changedCount = seenAt != null ? b.entries.filter(e => e.updatedAt > seenAt).length : 0;
  const lines = b.entries
    .map(e => `- ${(seenAt != null && e.updatedAt > seenAt) ? '🆕 ' : ''}[${e.id}] ${e.text} (by ${e.author})`)
    .join('\n');

  const attention = changedCount > 0
    ? `\n\n⚠ 自你上次以来，公告板有 ${changedCount} 处更新（上方 🆕 标记）——请留意并在后续工作中对齐，别做与之矛盾或已被取代的事。`
    : '';

  const usage = opts?.readOnly
    ? `\n\n（这是只读视图：你不能改公告板；如需变更请提示人类或对应工位。）`
    : `\n\n维护方式：用 bulletin 工具 —— add(text) 新增 / get 读取；改写和删除仅人类可执行。仅在产生需要全体知晓的结论、目标或状态变化时写，别刷屏、别写私事。`;

  return `## 工作室公告板

这是全体工位共享的公告板（人类与工位都可写，所有工位可见）——代表本工作室当前的共识、目标或通知，是高于单次对话的背景约束。

${b.entries.length ? lines : '（当前公告板为空）'}${attention}${usage}`;
}
