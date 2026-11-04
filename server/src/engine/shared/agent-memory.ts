/**
 * Agent 长期记忆 —— 跨功能共享基建（季风/对流/气旋/信风通用）
 *
 * 存储位置：data/agents/{id}/memory/。
 * 一文件一条目（{slug}.md，frontmatter+正文），外加 index.md 召回索引（一行一条目）。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { agentMemoryDir } from '../../services/data-paths.js';
import { atomicWriteFile } from './atomic-io';
import type { ToolDef } from './tool-defs-loader';
import { withAgentMemoryMutation } from './agent-memory-lock.js';
import { FrameworkError } from './framework-error.js';
import { recallToolDefs, executeRecallTool } from './memory-recall/read-tools.js';
import { MEMORY_REFERENCE_NOTE, MEMORY_MAINTENANCE_GUIDANCE } from './memory-guidance.js';

// ── 类型 ──────────────────────────────────────────────────────────

export type MemoryCategory = 'feedback' | 'fact' | 'pitfall' | 'reference';
export type MemoryTier = 'frequent' | 'normal' | 'archived';
export function memoryTier(entry: { tier?: MemoryTier; category: MemoryCategory }): MemoryTier {
  return entry.tier ?? (entry.category === 'feedback' ? 'frequent' : 'normal');
}

export interface MemoryEntry {
  slug: string;
  category: MemoryCategory;
  tags: string[];
  summary: string;      // 一句话摘要（进 index，供召回打分）
  detail: string;       // 全文正文
  created: string;      // ISO8601 带时区
  updated: string;
  hits: number;         // 命中次数；当前不参与排序
  source: string;       // 学到该条目的功能区（tradewind/convection/chat/cyclone/human）
  scope?: string;
  originSession?: string;
  /**
   * 摘要待精炼：true = summary 是系统从正文兜底截取的粗摘要（人只写了正文），
   * 等 agent 下次用到记忆时顺手精炼。false = 已由 agent/人给定正式摘要。
   */
  summaryPending: boolean;
  tier?: MemoryTier;
}

/**
 * 从正文兜底生成一句话摘要（人只写正文时用）：取首行首句、压缩空白、截断。
 * 正文为空时返回「（空）」。
 */
export function deriveSummary(detail: string): string {
  const firstLine = detail.trim().split('\n').map(l => l.trim()).find(Boolean) ?? '';
  const firstSentence = firstLine.split(/(?<=[。！？.!?])/)[0] || firstLine;
  const s = firstSentence.replace(/\s+/g, ' ').trim();
  return s.length > 60 ? `${s.slice(0, 60)}…` : (s || '（空）');
}

/** index.md 的一行（召回热路径只读它，不读全文） */
export interface MemoryIndexRow {
  slug: string;
  category: MemoryCategory;
  tags: string[];
  summary: string;
  tier?: MemoryTier;
}

// ── 路径 ──────────────────────────────────────────────────────────

function memoryDir(dataDir: string, agentId: string): string {
  return agentMemoryDir(dataDir, agentId);
}
function indexPath(dataDir: string, agentId: string): string {
  return path.join(memoryDir(dataDir, agentId), 'index.md');
}
function entryPath(dataDir: string, agentId: string, slug: string): string {
  if (typeof slug !== 'string' || !/^[\p{L}\p{N}_-]+$/u.test(slug) || slug.toLowerCase() === 'index') {
    throw new Error('记忆条目 slug 无效');
  }
  return path.join(memoryDir(dataDir, agentId), `${slug}.md`);
}

function memoryCorrupt(): FrameworkError {
  return new FrameworkError({ code: 'AGENT_MEMORY_CORRUPT', kind: 'io',
    message: '长期记忆数据损坏，原文件已保留，请修复后再继续。', source: 'agent.memory', retryable: false });
}

// ── slug 生成 ──────────────────────────────────────────────────────

/** 摘要 → kebab-case slug，非法字符转连字符；空则回退 mem。 */
function slugify(summary: string): string {
  const base = summary
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'mem';
}

/** 在已有 slug 集合中取唯一 slug：冲突则 -2 / -3 … 递增。 */
function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

// ── index.md 读写 ─────────────────────────────────────────────────
// 行格式：`- {slug} | {category} | {tag,tag} | {summary}`
// 人可读、易 grep，解析用固定分隔符（summary 里的 `|` 已在写入时替换为 ／）。

function serializeIndexRow(r: MemoryIndexRow): string {
  const tags = r.tags.join(',');
  const summary = r.summary.replace(/\|/g, '／').replace(/\s+/g, ' ').trim();
  return `- ${r.slug} | ${r.category} | ${tags} | ${summary} | tier=${memoryTier(r)}`;
}

function parseIndexRow(line: string): MemoryIndexRow | null {
  const m = line.match(/^-\s+(.+?)\s*\|\s*(.+?)\s*\|\s*(.*?)\s*\|\s*(.*)$/);
  if (!m) return null;
  const [, slug, category, tagsRaw, rawSummary] = m;
  const tierMatch = rawSummary.match(/\s*\|\s*tier=(frequent|normal|archived)$/);
  const summary = tierMatch ? rawSummary.slice(0, tierMatch.index).trim() : rawSummary;
  return {
    slug,
    category: (category as MemoryCategory),
    tags: tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [],
    summary,
    ...(tierMatch ? { tier: tierMatch[1] as MemoryTier } : {}),
  };
}

async function readIndex(dataDir: string, agentId: string): Promise<MemoryIndexRow[]> {
  let raw: string;
  try {
    raw = await fs.readFile(indexPath(dataDir, agentId), 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const rows: MemoryIndexRow[] = [];
  if (!raw.trim()) throw memoryCorrupt();
  const slugs = new Set<string>();
  for (const line of raw.split(/\r?\n/).map(value => value.trim())) {
    if (!line || line.startsWith('#')) continue;
    const row = parseIndexRow(line);
    if (!row || !/^[\p{L}\p{N}_-]+$/u.test(row.slug) || row.slug.toLowerCase() === 'index' || !CATEGORIES.includes(row.category)
      || slugs.has(row.slug)) throw memoryCorrupt();
    slugs.add(row.slug);
    rows.push(row);
  }
  return rows;
}

async function writeIndex(dataDir: string, agentId: string, rows: MemoryIndexRow[]): Promise<void> {
  const body = ['# 记忆索引（召回热路径唯一读取此文件）', '', ...rows.map(serializeIndexRow), ''].join('\n');
  await atomicWriteFile(indexPath(dataDir, agentId), body);
}

// ── 条目文件读写（frontmatter + 正文） ────────────────────────────

function serializeEntry(e: MemoryEntry): string {
  return [
    '---',
    `slug: ${e.slug}`,
    `category: ${e.category}`,
    `tags: [${e.tags.join(', ')}]`,
    `created: ${e.created}`,
    `updated: ${e.updated}`,
    `hits: ${e.hits}`,
    `source: ${e.source}`,
    `tier: ${memoryTier(e)}`,
    ...(e.scope ? [`scope: ${e.scope.replace(/[\r\n]/g, ' ').slice(0, 400)}`] : []),
    ...(e.originSession ? [`originSession: ${e.originSession.replace(/[\r\n]/g, ' ').slice(0, 180)}`] : []),
    `summaryPending: ${e.summaryPending}`,
    `summary: ${e.summary.replace(/\n/g, ' ')}`,
    '---',
    '',
    e.detail.trim(),
    '',
  ].join('\n');
}

function parseEntry(raw: string): MemoryEntry | null {
  raw = raw.replace(/\r\n/g, '\n');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const [, fm, detail] = m;
  const get = (k: string): string => {
    const line = fm.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'));
    return line ? line[1].trim() : '';
  };
  const tagsRaw = get('tags').replace(/^\[|\]$/g, '');
  return {
    slug: get('slug'),
    category: (get('category') as MemoryCategory) || 'fact',
    tags: tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [],
    summary: get('summary'),
    detail: detail.trim(),
    created: get('created'),
    updated: get('updated'),
    hits: Number(get('hits')) || 0,
    source: get('source'),
    ...(['frequent', 'normal', 'archived'].includes(get('tier')) ? { tier: get('tier') as MemoryTier } : {}),
    ...(get('scope') ? { scope: get('scope') } : {}),
    ...(get('originSession') ? { originSession: get('originSession') } : {}),
    // 旧条目无此字段 → 默认 false（视为已定摘要，不强行重炼）
    summaryPending: get('summaryPending') === 'true',
  };
}

// ── 公开 API ──────────────────────────────────────────────────────

export interface WriteMemoryInput {
  tier?: MemoryTier;
  scope?: string;
  originSession?: string;
  /** 可选：人只写正文时省略，系统从正文兜底并标记 summaryPending。agent 应尽量给。 */
  summary?: string;
  detail: string;
  category: MemoryCategory;
  tags?: string[];
  source: string;      // 由调用功能区传入（引擎侧，非 agent 填）
  now: string;         // ISO8601 时间戳（引擎注入，agent 不填）
}

/**
 * 写入一条记忆：生成唯一 slug → 原子写条目文件 → 更新 index.md。
 */
export async function writeMemory(
  dataDir: string,
  agentId: string,
  input: WriteMemoryInput,
): Promise<{ slug: string }> {
  return withAgentMemoryMutation(dataDir, agentId, () => writeMemoryMutation(dataDir, agentId, input));
}

async function writeMemoryMutation(
  dataDir: string, agentId: string, input: WriteMemoryInput,
): Promise<{ slug: string }> {
  await fs.mkdir(memoryDir(dataDir, agentId), { recursive: true });
  const rows = await readIndex(dataDir, agentId);

  // 摘要：给了就用（正式），没给则从正文兜底并标待精炼
  const given = input.summary?.trim();
  const summary = given || deriveSummary(input.detail);
  const summaryPending = !given;
  const diskNames = (await fs.readdir(memoryDir(dataDir, agentId)))
    .filter(name => name.endsWith('.md')).map(name => name.slice(0, -3));
  const slug = uniqueSlug(slugify(summary), new Set(['index', ...rows.map(r => r.slug), ...diskNames]
    .map(name => name.toLowerCase())));

  const entry: MemoryEntry = {
    slug,
    category: input.category,
    tags: input.tags ?? [],
    summary,
    detail: input.detail,
    created: input.now,
    updated: input.now,
    hits: 0,
    source: input.source,
    ...(input.scope ? { scope: input.scope.replace(/[\r\n]/g, ' ').slice(0, 400) } : {}),
    ...(input.originSession ? { originSession: input.originSession } : {}),
    summaryPending,
    ...(input.tier ? { tier: input.tier } : {}),
  };

  await atomicWriteFile(entryPath(dataDir, agentId, slug), serializeEntry(entry));
  rows.push({ slug, category: entry.category, tags: entry.tags, summary: entry.summary, tier: memoryTier(entry) });
  await writeIndex(dataDir, agentId, rows);
  return { slug };
}

/** 列举全部记忆索引（给 memory_list 工具用）。 */
export async function listMemory(dataDir: string, agentId: string): Promise<MemoryIndexRow[]> {
  return readIndex(dataDir, agentId);
}

/** 列举全部条目的全文（给人类面板用）：读 index 再逐条读全文，按 updated 倒序。 */
export async function listMemoryFull(dataDir: string, agentId: string): Promise<MemoryEntry[]> {
  const rows = await readIndex(dataDir, agentId);
  const entries: MemoryEntry[] = [];
  for (const r of rows) {
    const e = await readMemory(dataDir, agentId, r.slug);
    if (e) entries.push(e);
  }
  return entries.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
}

/** 读单条全文（给 memory_read 工具用）；不存在返回 null。 */
export async function readMemory(
  dataDir: string,
  agentId: string,
  slug: string,
): Promise<MemoryEntry | null> {
  const file = entryPath(dataDir, agentId, slug);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const entry = parseEntry(raw);
  if (!entry || entry.slug !== slug || !CATEGORIES.includes(entry.category)) throw memoryCorrupt();
  return entry;
}

/** 删一条（人类在面板操作）：删条目文件 + 从 index 摘除。不存在则静默。 */
export async function deleteMemory(dataDir: string, agentId: string, slug: string, expectedUpdated?: string): Promise<void> {
  await withAgentMemoryMutation(dataDir, agentId, async () => {
    if (expectedUpdated) assertMemoryVersion(await readMemory(dataDir, agentId, slug), expectedUpdated);
    const rows = (await readIndex(dataDir, agentId)).filter(r => r.slug !== slug);
    await fs.rm(entryPath(dataDir, agentId, slug), { force: true });
    await writeIndex(dataDir, agentId, rows);
  });
}

export interface UpdateMemoryInput {
  tier?: MemoryTier;
  scope?: string;
  expectedUpdated?: string;
  summary?: string;
  detail?: string;
  category?: MemoryCategory;
  tags?: string[];
  now: string;   // 引擎注入的时间戳，写入 updated
}

/** 改一条（人类在面板编辑）：合并字段、bump updated、原子写、同步 index。不存在返回 null。 */
export async function updateMemory(
  dataDir: string,
  agentId: string,
  slug: string,
  patch: UpdateMemoryInput,
): Promise<MemoryEntry | null> {
  return withAgentMemoryMutation(dataDir, agentId, () => updateMemoryMutation(dataDir, agentId, slug, patch));
}

async function updateMemoryMutation(
  dataDir: string, agentId: string, slug: string, patch: UpdateMemoryInput,
): Promise<MemoryEntry | null> {
  const rows = await readIndex(dataDir, agentId);
  const cur = await readMemory(dataDir, agentId, slug);
  if (!cur) return null;
  if (patch.expectedUpdated) assertMemoryVersion(cur, patch.expectedUpdated);
  const detail = patch.detail ?? cur.detail;
  const givenSummary = patch.summary?.trim();

  // 摘要三态：① 显式给 → 正式(pending=false)；② 只改正文 → 重新兜底(pending=true)；
  // ③ 都没动 → 保持原摘要与原 pending 态。
  let summary = cur.summary;
  let summaryPending = cur.summaryPending;
  if (givenSummary) {
    summary = givenSummary;
    summaryPending = false;
  } else if (patch.detail !== undefined && patch.detail !== cur.detail) {
    summary = deriveSummary(detail);
    summaryPending = true;
  }

  const next: MemoryEntry = {
    ...cur,
    summary,
    summaryPending,
    detail,
    category: patch.category ?? cur.category,
    tags: patch.tags ?? cur.tags,
    updated: new Date(Math.max(Date.parse(patch.now), (Date.parse(cur.updated) || 0) + 1)).toISOString(),
    ...(patch.tier ? { tier: patch.tier } : {}),
    ...(patch.scope !== undefined ? { scope: patch.scope.replace(/[\r\n]/g, ' ').slice(0, 400) } : {}),
  };
  await atomicWriteFile(entryPath(dataDir, agentId, slug), serializeEntry(next));
  const i = rows.findIndex(r => r.slug === slug);
  const row: MemoryIndexRow = { slug, category: next.category, tags: next.tags, summary: next.summary, tier: memoryTier(next) };
  if (i >= 0) rows[i] = row; else rows.push(row);
  await writeIndex(dataDir, agentId, rows);
  return next;
}

// ── 召回（读注入） ────────────────────────────────────────────────

/** category=feedback 的记忆作为常驻档。 */
function isPinned(row: MemoryIndexRow): boolean {
  return row.category === 'feedback' && memoryTier(row) === 'frequent';
}

/**
 * 按 taskHint 词项与条目 tags、summary 的包含关系计分。
 */
function scoreRelevance(row: MemoryIndexRow, hintTokens: Set<string>): number {
  if (hintTokens.size === 0) return 0;
  const hay = `${row.tags.join(' ')} ${row.summary}`.toLowerCase();
  let score = 0;
  for (const tok of hintTokens) if (tok && hay.includes(tok)) score++;
  return score;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/[^\p{L}\p{N}]+/u).map(t => t.trim()).filter(t => t.length >= 2),
  );
}

export interface RecallOptions {
  /** 情境档最多带几条（常驻档不受此限，必带） */
  maxContextual?: number;
}

/**
 * 召回并拼成可直接注入 system prompt 的记忆段。无记忆/无命中返回 ''。
 *
 * 组成 = 常驻档（全带，即"至少召回一次"）+ 情境档（按 taskHint 打分 top-N）。
 * 读全文只发生在中选条目上（热路径主要读 index.md）。
 */
export async function recallMemory(
  dataDir: string,
  agentId: string,
  taskHint?: string,
  opts: RecallOptions = {},
): Promise<string> {
  const rows = (await readIndex(dataDir, agentId)).filter(row => memoryTier(row) !== 'archived');
  if (rows.length === 0) return '';

  const maxContextual = opts.maxContextual ?? 5;
  const pinned = rows.filter(isPinned);
  const rest = rows.filter(r => !isPinned(r));

  const hintTokens = tokenize(taskHint ?? '');
  const scored = rest
    .map(r => ({ r, s: scoreRelevance(r, hintTokens) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || a.r.slug.localeCompare(b.r.slug)) // 并列按 slug 稳定排序
    .slice(0, maxContextual)
    .map(x => x.r);

  const selected = [...pinned, ...scored];
  if (selected.length === 0) return '';

  const blocks: string[] = [];
  for (const row of selected) {
    const entry = await readMemory(dataDir, agentId, row.slug);
    if (entry) blocks.push(`## ${entry.summary}\n${entry.detail}`);
  }
  if (blocks.length === 0) return '';

  return `# 回想起的记忆\n\n${MEMORY_REFERENCE_NOTE}\n\n${blocks.join('\n\n')}`;
}

// ── 工具层（四引擎共享：季风/对流/气旋/信风一致） ─────────────────

export const MEMORY_TOOL_NAMES = ['memory_manage', 'recall_search', 'recall_read', 'memory_write', 'memory_list', 'memory_read', 'memory_update', 'memory_delete'] as const;
const CATEGORIES: MemoryCategory[] = ['feedback', 'fact', 'pitfall', 'reference'];

/** 记忆工具的 ToolDef（native 模式注入 tools 参数；文本模式由 prompt 段承载）。 */
export function buildMemoryToolDefs(): ToolDef[] {
  return [...recallToolDefs(), {
    name: 'memory_manage',
    description: `维护自己的精选长期记忆，不修改压缩工作记录。${MEMORY_MAINTENANCE_GUIDANCE}`,
    parameters: { type: 'object', properties: {
      action: { type: 'string', enum: ['create', 'update', 'archive', 'restore', 'delete'] },
      id: { type: 'string', description: '除create外必填，recall_search/read返回的memory:开头ID' },
      expectedUpdated: { type: 'string', description: '除create外必填，recall_read返回的updated，冲突后重新读取' },
      summary: { type: 'string', description: 'create必填，一句话摘要' },
      detail: { type: 'string', description: 'create必填，记忆正文及适用条件' },
      category: { type: 'string', enum: CATEGORIES },
      tags: { type: 'string', description: '逗号分隔；空字符串清空标签' },
      scope: { type: 'string', description: '适用项目与前提条件' },
    }, required: ['action'] },
  }];
}

/**
 * 记忆工具统一执行器。引擎侧按 MEMORY_TOOL_NAMES 拦截后转此处，
 * source（哪个功能区）与时间戳由调用方补——agent 不填。返回纯文本回执。
 */
export async function execMemoryTool(
  dataDir: string,
  agentId: string,
  source: string,
  tool: string,
  args: Record<string, string>,
  originSession?: string,
): Promise<string> {
  if (tool === 'recall_search' || tool === 'recall_read') {
    const { createRecallCatalog } = await import('./memory-recall/catalog.js');
    return executeRecallTool(dataDir, agentId, createRecallCatalog(dataDir), tool, args);
  }
  if (tool === 'memory_manage') {
    const action = args.action;
    if (!['create', 'update', 'archive', 'restore', 'delete'].includes(action)) throw new Error('MEMORY_ACTION_INVALID');
    const fields = ['summary', 'detail', 'category', 'tags', 'scope'];
    const allowed = ['action', ...(action === 'create' ? fields : ['id', 'expectedUpdated', ...(action === 'update' ? fields : [])])];
    if (Object.keys(args).some(key => !allowed.includes(key))) throw new Error('MEMORY_ARGUMENTS_INVALID');
    const { action: _action, id, ...input } = args;
    if (action === 'create') {
      if (!args.summary?.trim() || !args.detail?.trim()) throw new Error('MEMORY_DETAIL_REQUIRED');
      if (args.category !== undefined && !CATEGORIES.includes(args.category as MemoryCategory)) throw new Error('MEMORY_CATEGORY_INVALID');
      return (await execMemoryTool(dataDir, agentId, source, 'memory_write', input, originSession))
        .replace(/slug=([\p{L}\p{N}_-]+)/u, 'id=memory:$1');
    }
    if (!id?.startsWith('memory:') || !/^[\p{L}\p{N}_-]+$/u.test(id.slice(7))) throw new Error('MEMORY_ID_INVALID');
    if (action === 'update' && !fields.some(key => args[key] !== undefined)) throw new Error('MEMORY_PATCH_REQUIRED');
    return (await execMemoryTool(dataDir, agentId, source, action === 'delete' ? 'memory_delete' : 'memory_update', {
      ...input, slug: id.slice(7), ...(action === 'archive' ? { tier: 'archived' } : action === 'restore' ? { tier: 'normal' } : {}),
    }, originSession)).replace(/slug=([\p{L}\p{N}_-]+)/u, 'id=memory:$1');
  }
  if (tool === 'memory_update' || tool === 'memory_delete') {
    if (!args.slug?.trim() || !args.expectedUpdated?.trim()) throw new Error('MEMORY_VERSION_REQUIRED');
    const slug = args.slug.trim();
    if (tool === 'memory_delete') {
      await deleteMemory(dataDir, agentId, slug, args.expectedUpdated);
      return `已删除长期记忆（slug=${slug}）。`;
    }
    if (args.detail !== undefined && !args.detail.trim()) throw new Error('MEMORY_DETAIL_REQUIRED');
    if (args.category !== undefined && !CATEGORIES.includes(args.category as MemoryCategory)) throw new Error('MEMORY_CATEGORY_INVALID');
    if (args.tier !== undefined && !['frequent', 'normal', 'archived'].includes(args.tier)) throw new Error('MEMORY_TIER_INVALID');
    const entry = await updateMemory(dataDir, agentId, slug, { expectedUpdated: args.expectedUpdated,
      summary: args.summary, detail: args.detail, category: args.category as MemoryCategory | undefined, scope: args.scope,
      tier: args.tier as MemoryTier | undefined,
      ...(args.tags !== undefined ? { tags: args.tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean) } : {}), now: new Date().toISOString() });
    if (!entry) throw new Error('MEMORY_SOURCE_UNAVAILABLE');
    const result = args.tier === 'archived' ? '已归档长期记忆，保留正文并退出自动召回'
      : args.tier === 'normal' ? '已恢复长期记忆，可参与自动召回' : '已更新长期记忆';
    return `${result}（slug=${slug}，updated=${entry.updated}）。`;
  }
  if (tool === 'memory_write') {
    const summary = (args.summary || '').trim();
    const detail = (args.detail || '').trim();
    if (!summary || !detail) return '记忆写入失败：summary 和 detail 均不能为空。';
    const category = (CATEGORIES as string[]).includes(args.category)
      ? (args.category as MemoryCategory) : 'fact';
    const tags = typeof args.tags === 'string' && args.tags.trim()
      ? args.tags.split(/[,，]/).map(t => t.trim()).filter(Boolean) : [];
    const { slug } = await writeMemory(dataDir, agentId, {
      summary, detail, category, tags, source, now: new Date().toISOString(),
      ...(typeof args.scope === 'string' ? { scope: args.scope.trim() } : {}),
      ...(originSession ? { originSession } : {}),
    });
    return `已记入长期记忆（slug=${slug}，类别=${category}）。`;
  }
  if (tool === 'memory_list') {
    const rows = await listMemory(dataDir, agentId);
    if (rows.length === 0) return '（长期记忆为空）';
    return `${MEMORY_REFERENCE_NOTE}\n\n${memoryPage(rows, args)}`;
  }
  if (tool === 'memory_read') {
    const entry = await readMemory(dataDir, agentId, (args.slug || '').trim());
    if (!entry) return `未找到记忆条目：${args.slug}`;
    return `${MEMORY_REFERENCE_NOTE}\nslug: ${entry.slug}\nupdated: ${entry.updated}\ntier: ${memoryTier(entry)}\nscope: ${entry.scope ?? ''}\n\n## ${entry.summary}\n${entry.detail}`;
  }
  return `未知记忆工具：${tool}`;
}

function assertMemoryVersion(entry: MemoryEntry | null, expected: string): void {
  if (!entry || entry.updated !== expected) throw new FrameworkError({ code: 'AGENT_MEMORY_CONFLICT', kind: 'conflict',
    message: '记忆已修改或删除，请重新读取后合并。', source: 'agent.memory', retryable: false });
}

function memoryPage(rows: MemoryIndexRow[], args: Record<string, string>): string {
  const offset = args.offset === undefined ? 0 : Number(args.offset);
  const limit = args.limit === undefined ? 50 : Number(args.limit);
  const query = (args.query ?? '').trim().toLowerCase();
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100
    || query.length > 400) return '记忆列表参数无效：offset需为非负整数，limit为1至100，query最多400字符。';
  const status = args.status ?? 'all';
  if (!['all', 'active', 'archived'].includes(status)) throw new Error('MEMORY_STATUS_INVALID');
  const selected = rows.filter(row => status === 'all' || (memoryTier(row) === 'archived') === (status === 'archived'));
  const matches = query ? selected.filter(row => `${row.slug} ${row.summary} ${row.tags.join(' ')}`.toLowerCase().includes(query)) : selected;
  const lines: string[] = [];
  let size = 0;
  for (const row of matches.slice(offset, offset + limit)) {
    const line = `- ${row.slug} [${row.category}] [${memoryTier(row)}] ${row.summary.slice(0, 240)}${row.tags.length ? ` #${row.tags.slice(0, 10).map(tag => tag.slice(0, 40)).join(' #')}` : ''}`;
    if (lines.length && size + line.length > 7500) break;
    lines.push(line); size += line.length + 1;
  }
  const next = offset + lines.length;
  return `${lines.join('\n')}\n共 ${matches.length} 条，本页 ${lines.length} 条。${next < matches.length ? `继续读取：offset=${next}。` : '已到末页。'}`;
}
