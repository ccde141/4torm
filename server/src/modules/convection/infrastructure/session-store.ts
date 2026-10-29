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
import type { ContextMessage } from '../../../engine/shared/types.js';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import { readConvectionJson } from './quarantined-json.js';
import { recoverConvectionCompaction } from './compaction-progress.js';
import { readIndex, mutateIndex } from './session-index.js';
import { readConvectionModelUsage } from './model-usage-store.js';
import {
  convectionSessionFile,
  convectionSessionDir,
  convectionSessionWorkspace,
  convectionSessionsDir,
} from '../../../services/data-paths.js';

// ── 数据结构 ──────────────────────────────────────────────────

export interface ConvectionSessionData {
  publicModelUsage?: import('../../../engine/shared/model-request-usage.js').ModelUsageProgress;
  chairModelUsage?: import('../../../engine/shared/model-request-usage.js').ModelUsageProgress;
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
  publicDisplayHistory?: ConvectionMessage[];
  publicDisplayContextCount?: number;
  /** Current participant display checkpoint; excluded from model context. */
  publicExecutionDraft?: ConvectionMessage;
  /** 会长私聊历史 */
  chairMessages: Array<ContextMessage & { runId?: string }>;
  chairDisplayHistory?: Array<ContextMessage & { runId?: string }>;
  chairDisplayContextCount?: number;
  /** Compressed assistant model history; public/private source records remain independent. */
  chairActiveContext?: ContextMessage[];
  chairContextRawCount?: number;
  chairContextPublicAnchor?: { timestamp: number; hash: string };
  /** Estimate of the exact prior provider input, before its assistant reply was appended. */
  chairRequestEstimate?: number;
  /** 本轮公聊参与模型的最大已知 prompt 用量；旧文件可能缺失。 */
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  /** 公聊最近一次模型请求用量，供界面展示；与本轮最大值分开。 */
  publicLatestTokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  /** 本轮有模型未报告用量时，公聊整体用量未知。 */
  publicUsageIncomplete?: boolean;
  /** 会长最近一次模型调用的实际用量。 */
  chairTokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  /** 压缩状态 */
  compactState?: { disabled: boolean; archiveSeq: number };
  /** Acknowledged by the next accepted human input; original notice remains in run events. */
  compactionNotice?: import('../../../engine/shared/compaction/contracts.js').CompactionNotice;
  chairCompactionNotice?: import('../../../engine/shared/compaction/contracts.js').CompactionNotice;
  compactionProgress?: import('../../../engine/shared/compaction/contracts.js').CompactionProgress;
  chairCompactionProgress?: import('../../../engine/shared/compaction/contracts.js').CompactionProgress;
  createdAt: string;
  updatedAt: string;
}

export interface ConvectionMessage {
  recordId?: string;
  execution?: { status: 'running' | 'failed' | 'stopped'; message?: string };
  compactionId?: string;
  compactions?: Array<{ id: string; summary: string; toolOffset: number; textOffset: number; reasoningOffset: number }>;
  displayContent?: string;
  /** 启动本次公开发言的运行 ID；旧消息可能缺失。 */
  runId?: string;
  /** 稳定的 Agent 实体 ID；旧消息可能缺失。 */
  agentId?: string;
  speaker: string;
  content: string;
  timestamp: number;
  /** Agent 回复的原始 LLM 输出（含标签），前端解析渲染用 */
  rawContent?: string;
  /** Provider 原生 reasoning 旁路，不进入公共上下文。 */
  reasoning?: string;
  /** 本轮工具调用记录 */
  toolCalls?: Array<{ tool: string; args: Record<string, unknown>; result: string;
    completed?: boolean; ok?: boolean;
    toolImages?: import('../../../engine/shared/types.js').ToolImageRef[] }>;
}

/** 会话列表摘要（前端列表用，不含完整消息） */
export interface ConvectionSessionSummary {
  publicCurrentInput?: import('../../../engine/shared/model-request-usage.js').CurrentInputEstimate;
  chairCurrentInput?: import('../../../engine/shared/model-request-usage.js').CurrentInputEstimate;
  publicModelUsage?: import('../../../engine/shared/model-request-usage.js').ModelUsageProgress;
  chairModelUsage?: import('../../../engine/shared/model-request-usage.js').ModelUsageProgress;
  id: string;
  title: string;
  chairAgentId: string;
  participantAgentIds: string[];
  topic: string;
  messageCount: number;
  tokenEstimate: number;
  /** 真实 API token 用量（有数据时优先用这个） */
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  publicLatestTokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  chairTokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  createdAt: string;
  updatedAt: string;
}

// ── 持久化 Store ──────────────────────────────────────────────

export function sessionWorkspace(dataDir: string, id: string): string {
  return convectionSessionWorkspace(dataDir, id);
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
  // Reject an unresolved damaged index before creating any new primary or workspace.
  await readIndex(dataDir);
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
  await ensureDir(convectionSessionsDir(dataDir));
  await ensureDir(sessionWorkspace(dataDir, id));
  await atomicWriteFile(convectionSessionFile(dataDir, id), JSON.stringify(session, null, 2));
  await mutateIndex(dataDir, index => [...index, id]);
  return session;
}

/** 原子写：先写临时文件，再 rename 覆盖目标，防止半截 JSON */
/** 保存会话（更新 updatedAt） */
export async function saveSession(dataDir: string, session: ConvectionSessionData, signal?: AbortSignal): Promise<void> {
  session.updatedAt = new Date().toISOString();
  await atomicWriteFile(convectionSessionFile(dataDir, session.id), JSON.stringify(session, null, 2), signal);
}

/** 加载单个会话 */
export async function loadSession(dataDir: string, id: string): Promise<ConvectionSessionData | null> {
  const session = await readConvectionJson<ConvectionSessionData>(convectionSessionFile(dataDir, id));
  if (session) {
    const modelUsage = await readConvectionModelUsage(dataDir, id);
    Object.assign(session, modelUsage);
    session.compactionProgress = recoverConvectionCompaction(session.compactionProgress);
    session.chairCompactionProgress = recoverConvectionCompaction(session.chairCompactionProgress);
  }
  return session;
}

/** 列出所有会话（摘要 + token 估算，按 updatedAt 降序） */
export async function listSessions(dataDir: string): Promise<ConvectionSessionSummary[]> {
  const index = await readIndex(dataDir);
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
      publicLatestTokenUsage: s.publicLatestTokenUsage || undefined,
      chairTokenUsage: s.chairTokenUsage || undefined,
      publicModelUsage: s.publicModelUsage,
      chairModelUsage: s.chairModelUsage,
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
  await removeStrict(convectionSessionFile(dataDir, id));
  await removeStrict(convectionSessionDir(dataDir, id), { recursive: true });
  await mutateIndex(dataDir, index => index.filter(item => item !== id));
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
  const index = await readIndex(dataDir);
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
