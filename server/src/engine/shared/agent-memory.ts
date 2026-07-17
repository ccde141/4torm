/**
 * Agent 长期记忆 —— 跨功能共享基建（季风/对流/气旋/信风通用）
 *
 * 定位：把长期记忆当「持续学习后的知识检索」问题。本文件是 MVP：
 * 文本条目存储 + 主动注入 + agent 自写，先打通读写链路。
 * 检索规模化（候选召回→重排→预算填充）见设计草案 §六，届时只换 rankEntries 后端。
 *
 * 存储位置：data/agents/{id}/memory/（**在 .workspace 沙箱之外**，引擎专管、
 * 经工具中介访问，避免被 agent 工作文件淹没或误删）。
 * 一文件一条目（{slug}.md，frontmatter+正文），外加 index.md 召回索引（一行一条目）。
 *
 * 纯 IO + 文本，不含业务逻辑 → 不违反「模块间零业务交叉」。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { agentMemoryDir } from '../../services/data-paths.js';
import { atomicWriteFile } from './atomic-io';
import type { ToolDef } from './tool-defs-loader';

// ── 类型 ──────────────────────────────────────────────────────────

export type MemoryCategory = 'feedback' | 'fact' | 'pitfall' | 'reference';

export interface MemoryEntry {
  slug: string;
  category: MemoryCategory;
  tags: string[];
  summary: string;      // 一句话摘要（进 index，供召回打分）
  detail: string;       // 全文正文
  created: string;      // ISO8601 带时区
  updated: string;
  hits: number;         // 命中次数，反哺未来打分；MVP 只记不用
  source: string;       // 学到该条目的功能区（tradewind/convection/chat/cyclone/human）
  /**
   * 摘要待精炼：true = summary 是系统从正文兜底截取的粗摘要（人只写了正文），
   * 等 agent 下次用到记忆时顺手精炼。false = 已由 agent/人给定正式摘要。
   */
  summaryPending: boolean;
}

/**
 * 从正文兜底生成一句话摘要（人只写正文时用）：取首行首句、压缩空白、截断。
 * 保证"存的瞬间就可召回、永不空白"，与 AI 精炼是否到位无关。
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
}

// ── 路径 ──────────────────────────────────────────────────────────

function memoryDir(dataDir: string, agentId: string): string {
  return agentMemoryDir(dataDir, agentId);
}
function indexPath(dataDir: string, agentId: string): string {
  return path.join(memoryDir(dataDir, agentId), 'index.md');
}
function entryPath(dataDir: string, agentId: string, slug: string): string {
  return path.join(memoryDir(dataDir, agentId), `${slug}.md`);
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
  return `- ${r.slug} | ${r.category} | ${tags} | ${summary}`;
}

function parseIndexRow(line: string): MemoryIndexRow | null {
  const m = line.match(/^-\s+(.+?)\s*\|\s*(.+?)\s*\|\s*(.*?)\s*\|\s*(.*)$/);
  if (!m) return null;
  const [, slug, category, tagsRaw, summary] = m;
  return {
    slug,
    category: (category as MemoryCategory),
    tags: tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [],
    summary,
  };
}

async function readIndex(dataDir: string, agentId: string): Promise<MemoryIndexRow[]> {
  try {
    const raw = await fs.readFile(indexPath(dataDir, agentId), 'utf-8');
    return raw.split('\n').map(parseIndexRow).filter((r): r is MemoryIndexRow => r !== null);
  } catch {
    return [];
  }
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
    `summaryPending: ${e.summaryPending}`,
    `summary: ${e.summary.replace(/\n/g, ' ')}`,
    '---',
    '',
    e.detail.trim(),
    '',
  ].join('\n');
}

function parseEntry(raw: string): MemoryEntry | null {
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
    // 旧条目无此字段 → 默认 false（视为已定摘要，不强行重炼）
    summaryPending: get('summaryPending') === 'true',
  };
}

// ── 公开 API ──────────────────────────────────────────────────────

export interface WriteMemoryInput {
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
 * MVP 全自动落库（人工闸见设计草案 §八，后续可在此加"待确认区"）。
 */
export async function writeMemory(
  dataDir: string,
  agentId: string,
  input: WriteMemoryInput,
): Promise<{ slug: string }> {
  await fs.mkdir(memoryDir(dataDir, agentId), { recursive: true });
  const rows = await readIndex(dataDir, agentId);

  // 摘要：给了就用（正式），没给则从正文兜底并标待精炼
  const given = input.summary?.trim();
  const summary = given || deriveSummary(input.detail);
  const summaryPending = !given;
  const slug = uniqueSlug(slugify(summary), new Set(rows.map(r => r.slug)));

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
    summaryPending,
  };

  await atomicWriteFile(entryPath(dataDir, agentId, slug), serializeEntry(entry));
  rows.push({ slug, category: entry.category, tags: entry.tags, summary: entry.summary });
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
  try {
    return parseEntry(await fs.readFile(entryPath(dataDir, agentId, slug), 'utf-8'));
  } catch {
    return null;
  }
}

/** 删一条（人类在面板操作）：删条目文件 + 从 index 摘除。不存在则静默。 */
export async function deleteMemory(dataDir: string, agentId: string, slug: string): Promise<void> {
  await fs.rm(entryPath(dataDir, agentId, slug), { force: true });
  const rows = (await readIndex(dataDir, agentId)).filter(r => r.slug !== slug);
  await writeIndex(dataDir, agentId, rows);
}

export interface UpdateMemoryInput {
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
  const cur = await readMemory(dataDir, agentId, slug);
  if (!cur) return null;
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
    updated: patch.now,
  };
  await atomicWriteFile(entryPath(dataDir, agentId, slug), serializeEntry(next));
  const rows = await readIndex(dataDir, agentId);
  const i = rows.findIndex(r => r.slug === slug);
  const row: MemoryIndexRow = { slug, category: next.category, tags: next.tags, summary: next.summary };
  if (i >= 0) rows[i] = row; else rows.push(row);
  await writeIndex(dataDir, agentId, rows);
  return next;
}

// ── 召回（读注入） ────────────────────────────────────────────────

/** 常驻档判定：MVP 按 category=feedback 一刀切（pinned 见设计草案 §八）。 */
function isPinned(row: MemoryIndexRow): boolean {
  return row.category === 'feedback';
}

/**
 * 情境相关性打分（**可插拔后端**）。
 * MVP：taskHint 与条目 tags+summary 的词重叠计数。
 * 未来换便宜模型打分 / 向量余弦时，只改此函数，上层排序+预算填充骨架不动。
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
  const rows = await readIndex(dataDir, agentId);
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

  return `# 你的经验记忆\n\n以下是你在过往工作中积累的、与当前任务相关的经验：\n\n${blocks.join('\n\n')}`;
}

// ── 工具层（四引擎共享：季风/对流/气旋/信风一致） ─────────────────

export const MEMORY_TOOL_NAMES = ['memory_write', 'memory_list', 'memory_read'] as const;
const CATEGORIES: MemoryCategory[] = ['feedback', 'fact', 'pitfall', 'reference'];

/** 记忆工具的 ToolDef（native 模式注入 tools 参数；文本模式由 prompt 段承载）。 */
export function buildMemoryToolDefs(): ToolDef[] {
  return [
    {
      name: 'memory_write',
      description: '把一条跨任务复用的经验写入你的长期记忆（自动带时间戳，下次相关任务自动召回）。积极使用：只要出现值得下次复用的信息就记——用户的偏好/纠正、踩坑教训、确认的事实（约定/路径/接口/数据位置）、值得回访的资源。写入前先 memory_list 查有无同类，有则不重复。',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: '一句话摘要（召回匹配的关键，简洁准确）' },
          detail: { type: 'string', description: '经验全文：是什么、为什么、下次怎么用' },
          category: { type: 'string', description: 'feedback(偏好/纠正)|fact(可复用事实)|pitfall(踩坑)|reference(资源指针)' },
          tags: { type: 'string', description: '可选，逗号分隔标签（利于召回），如"pdf,解析"' },
        },
        required: ['summary', 'detail', 'category'],
      },
    },
    {
      name: 'memory_list',
      description: '列出你已有的长期记忆条目（slug+类别+摘要+标签），用于自查、避免重复写入。',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'memory_read',
      description: '按 slug 读取一条长期记忆全文（slug 用 memory_list 查看）。',
      parameters: {
        type: 'object',
        properties: { slug: { type: 'string', description: '记忆条目 slug' } },
        required: ['slug'],
      },
    },
  ];
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
): Promise<string> {
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
    });
    return `已记入长期记忆（slug=${slug}，类别=${category}）。下次相关任务会自动召回。`;
  }
  if (tool === 'memory_list') {
    const rows = await listMemory(dataDir, agentId);
    if (rows.length === 0) return '（长期记忆为空）';
    return rows.map(r => `- ${r.slug} [${r.category}] ${r.summary}${r.tags.length ? ` #${r.tags.join(' #')}` : ''}`).join('\n');
  }
  if (tool === 'memory_read') {
    const entry = await readMemory(dataDir, agentId, (args.slug || '').trim());
    if (!entry) return `未找到记忆条目：${args.slug}`;
    return `## ${entry.summary}\n${entry.detail}`;
  }
  return `未知记忆工具：${tool}`;
}
