/**
 * 对流会话数据结构 + 持久化 store
 *
 * 存储位置：data/convection/sessions/
 *   _index.json          — string[] 所有 sessionId
 *   {sessionId}.json     — ConvectionSessionData 完整对象
 *
 * 每个会话有独立 workspace：data/convection/sessions/{sessionId}/workspace/
 *
 * 设计对标普通会话系统（src/store/chat.ts），但面向多 Agent 群聊。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ContextMessage } from '../shared/types';

// ── 数据结构 ──────────────────────────────────────────────────

export interface ConvectionSessionData {
  id: string;
  title: string;
  /** 会长 Agent 实体 ID */
  chairAgentId: string;
  /** 参与 Agent 实体 ID 列表（可热配置） */
  participantAgentIds: string[];
  /** 话题 */
  topic: string;
  /** 公共消息历史 */
  publicMessages: ConvectionMessage[];
  /** 会长私聊历史 */
  chairMessages: ContextMessage[];
  /** 累计 token 用量（真实 API 返回值） */
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  /** 压缩状态 */
  compactState?: { disabled: boolean; archiveSeq: number };
  createdAt: string;
  updatedAt: string;
}

export interface ConvectionMessage {
  speaker: string;
  content: string;
  timestamp: number;
  /** Agent 回复的原始 LLM 输出（含标签），前端解析渲染用 */
  rawContent?: string;
  /** 本轮工具调用记录 */
  toolCalls?: Array<{ tool: string; args: Record<string, string>; result: string }>;
}

/** 会话列表摘要（前端列表用，不含完整消息） */
export interface ConvectionSessionSummary {
  id: string;
  title: string;
  chairAgentId: string;
  participantAgentIds: string[];
  topic: string;
  messageCount: number;
  tokenEstimate: number;
  /** 真实 API token 用量（有数据时优先用这个） */
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  createdAt: string;
  updatedAt: string;
}

// ── 持久化 Store ──────────────────────────────────────────────

function sessionsDir(dataDir: string): string {
  return path.join(dataDir, 'convection', 'sessions');
}

function sessionFile(dataDir: string, id: string): string {
  return path.join(sessionsDir(dataDir), `${id}.json`);
}

function indexFile(dataDir: string): string {
  return path.join(sessionsDir(dataDir), '_index.json');
}

export function sessionWorkspace(dataDir: string, id: string): string {
  return path.join(sessionsDir(dataDir), id, 'workspace');
}

async function readJsonSafe<T>(file: string): Promise<T | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    console.error(`[convection] 读取失败（非缺失，请检查权限/IO）：${file}`, e);
    throw e;
  }
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    const quarantine = `${file}.corrupt-${Date.now().toString(36)}`;
    try { await fs.rename(file, quarantine); } catch { /* 隔离失败也别让读崩，下面照样告警 */ }
    console.error(`[convection] JSON 损坏，已隔离为 ${quarantine}（原文件保留可恢复）：${(e as Error).message}`);
    return null;
  }
}

async function removeStrict(targetPath: string, opts?: { recursive?: boolean }): Promise<void> {
  try {
    await fs.rm(targetPath, { recursive: opts?.recursive ?? false, force: false });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw e;
  }
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/** 生成会话 ID */
function nextId(): string {
  return `conv-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 创建新会话 */
export async function createSession(
  dataDir: string,
  opts: { chairAgentId: string; participantAgentIds: string[]; topic?: string; title?: string },
): Promise<ConvectionSessionData> {
  const id = nextId();
  const now = new Date().toISOString();
  const session: ConvectionSessionData = {
    id,
    title: opts.title || `对流 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`,
    chairAgentId: opts.chairAgentId,
    participantAgentIds: opts.participantAgentIds,
    topic: opts.topic || '自由讨论',
    publicMessages: [],
    chairMessages: [],
    createdAt: now,
    updatedAt: now,
  };
  await ensureDir(sessionsDir(dataDir));
  await ensureDir(sessionWorkspace(dataDir, id));
  await atomicWrite(sessionFile(dataDir, id), JSON.stringify(session, null, 2));
  // 维护 index
  const index = (await readJsonSafe<string[]>(indexFile(dataDir))) || [];
  index.push(id);
  await atomicWrite(indexFile(dataDir), JSON.stringify(index));
  return session;
}

/** 原子写：先写临时文件，再 rename 覆盖目标，防止半截 JSON */
async function atomicWrite(filePath: string, data: string): Promise<void> {
  const tmp = filePath + '.tmp';
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, filePath);
}

/** 保存会话（更新 updatedAt） */
export async function saveSession(dataDir: string, session: ConvectionSessionData): Promise<void> {
  session.updatedAt = new Date().toISOString();
  await atomicWrite(sessionFile(dataDir, session.id), JSON.stringify(session, null, 2));
}

/** 加载单个会话 */
export async function loadSession(dataDir: string, id: string): Promise<ConvectionSessionData | null> {
  return readJsonSafe<ConvectionSessionData>(sessionFile(dataDir, id));
}

/** 列出所有会话（摘要 + token 估算，按 updatedAt 降序） */
export async function listSessions(dataDir: string): Promise<ConvectionSessionSummary[]> {
  const index = (await readJsonSafe<string[]>(indexFile(dataDir))) || [];
  const summaries: ConvectionSessionSummary[] = [];
  for (const id of index) {
    const s = await loadSession(dataDir, id);
    if (!s) continue;
    const totalText = s.publicMessages.map(m => m.content).join(' ') + s.chairMessages.map(m => m.content).join(' ');
    const tokenEstimate = estimateTokens(totalText);
    summaries.push({
      id: s.id, title: s.title, chairAgentId: s.chairAgentId,
      participantAgentIds: s.participantAgentIds, topic: s.topic,
      messageCount: s.publicMessages.length,
      tokenEstimate,
      tokenUsage: s.tokenUsage || undefined,
      createdAt: s.createdAt, updatedAt: s.updatedAt,
    });
  }
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function estimateTokens(text: string): number {
  let total = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 0x4E00 && code <= 0x9FFF) total += 0.6;
    else if (code >= 0x3040 && code <= 0x30FF) total += 0.6;
    else if (code >= 0xAC00 && code <= 0xD7AF) total += 0.6;
    else total += 0.3;
  }
  return Math.ceil(total);
}

/** 删除会话 */
export async function deleteSession(dataDir: string, id: string): Promise<void> {
  await removeStrict(sessionFile(dataDir, id));
  await removeStrict(path.join(sessionsDir(dataDir), id), { recursive: true });
  const index = (await readJsonSafe<string[]>(indexFile(dataDir))) || [];
  const filtered = index.filter(x => x !== id);
  await atomicWrite(indexFile(dataDir), JSON.stringify(filtered));
}

/** 重命名会话 */
export async function renameSession(dataDir: string, id: string, title: string): Promise<void> {
  const s = await loadSession(dataDir, id);
  if (!s) return;
  s.title = title;
  await saveSession(dataDir, s);
}

/** 检查 Agent 是否仍在任意对流会话中（排除指定 sessionId） */
export async function isAgentInAnySession(
  dataDir: string,
  agentId: string,
  excludeSessionId?: string,
): Promise<boolean> {
  const index = (await readJsonSafe<string[]>(indexFile(dataDir))) || [];
  for (const sid of index) {
    if (sid === excludeSessionId) continue;
    const s = await loadSession(dataDir, sid);
    if (!s) continue;
    if (s.chairAgentId === agentId) return true;
    if (s.participantAgentIds.includes(agentId)) return true;
  }
  return false;
}

// ── 并发锁（per-session 互斥） ───────────────────────────────

const locks = new Map<string, Promise<void>>();

/**
 * 尝试获取 session 锁。
 * 返回 release 函数表示获取成功；返回 null 表示锁已被占用。
 * 非阻塞设计：不排队等待，直接拒绝——让路由层返回 409。
 */
export function tryAcquireSessionLock(sessionId: string): (() => void) | null {
  if (locks.has(sessionId)) return null;
  let release!: () => void;
  const p = new Promise<void>(resolve => { release = resolve; });
  locks.set(sessionId, p);
  return () => { locks.delete(sessionId); release(); };
}
