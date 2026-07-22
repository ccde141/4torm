import { readJson, writeJson, ensureDir, deleteFile } from '../api/storage';
import type { Agent, ChatMessage } from '../types';
import { MissingIndexReadCache } from './session-index-cache';
import {
  tokenUsageFromMeta,
  tokenUsageToMeta,
  type TokenUsage,
  type TokenUsageMeta,
} from './chat-token';

export interface ChatSession {
  id: string;
  agentId: string;
  agentName: string;
  title: string;
  titleManual?: boolean;
  messages: ChatMessage[];
  model: string;
  systemPrompt: string;
  masterPrompt?: string;
  rolePrompt?: string;
  lastReadAt?: string;
  /** 累计 token 用量（真实 API 返回值） */
  tokenUsage?: TokenUsage;
  createdAt: string;
  updatedAt: string;
  /** 列表用：预计算的未读数（会话文件写入时由 saveSession 维护） */
  unreadCount?: number;
}

/** _index.json 的条目格式（轻量元信息，不含 messages） */
interface SessionMeta extends TokenUsageMeta {
  i: string;   // id
  t: string;   // title
  u: string;   // updatedAt
  n?: string;  // agentName
  r?: string;  // lastReadAt
  un?: number; // unreadCount
}

function isSessionMeta(value: unknown): value is SessionMeta {
  if (!value || typeof value !== 'object') return false;
  const meta = value as Partial<SessionMeta>;
  return typeof meta.i === 'string'
    && typeof meta.t === 'string'
    && typeof meta.u === 'string';
}

/** 计算未读数：最后一条 assistant 消息之后、lastReadAt 之后的消息数量 */
function computeUnread(s: ChatSession): number {
  const lastAssist = s.messages.findLastIndex(m => m.role === 'assistant');
  if (lastAssist < 0) return 0;
  // 从未读过的老会话视为已读（不是新未读），避免历史会话显示全量虚高未读数
  if (!s.lastReadAt) return 0;
  const lastReadIdx = s.messages.findLastIndex(m => m.timestamp <= s.lastReadAt!);
  return lastAssist > lastReadIdx ? s.messages.length - lastReadIdx - 1 : 0;
}

function toMeta(s: ChatSession): SessionMeta {
  // 有 messages（完整会话）时实时计算未读；否则沿用已存的 unreadCount（瘦对象）
  const un = s.messages.length ? computeUnread(s) : (s.unreadCount ?? 0);
  return {
    i: s.id, t: s.title, u: s.updatedAt,
    ...(s.agentName ? { n: s.agentName } : {}),
    ...(s.lastReadAt ? { r: s.lastReadAt } : {}),
    ...tokenUsageToMeta(s.tokenUsage),
    ...(un ? { un } : {}),
  };
}

function fromMeta(m: SessionMeta, agentId: string): ChatSession {
  return {
    id: m.i, agentId, agentName: m.n ?? '',
    title: m.t, updatedAt: m.u,
    lastReadAt: m.r,
    tokenUsage: tokenUsageFromMeta(m),
    unreadCount: m.un,
    messages: [], model: '', systemPrompt: '', createdAt: m.u,
  } as ChatSession;
}

function metaPath(agentId: string): string {
  return `agents/${agentId}/sessions/_index.json`;
}

/** 记录最近完整加载过的会话 messages，供切会话时立即上屏用 */
const msgCache = new Map<string, ChatMessage[]>();

function sessionPath(agentId: string, sessionId: string): string {
  return `agents/${agentId}/sessions/${sessionId}.json`;
}

let cache: Record<string, ChatSession> | null = null;
const indexReadCache = new MissingIndexReadCache<SessionMeta[] | string[]>();

async function saveSessionToFile(s: ChatSession) {
  await ensureDir(`agents/${s.agentId}/sessions`);
  await writeJson(sessionPath(s.agentId, s.id), s);
  if (cache) cache[s.id] = s;
}

function nextId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function generateSessionId(agentId: string): string {
  return `${agentId}-${nextId()}`;
}

export function generateMessageId(): string {
  return `msg-${nextId()}`;
}

/** 纯构造一个新会话对象，不写磁盘。用于 UI 乐观更新（先上屏，后台再 saveSession）。 */
export function buildSession(agent: Agent, model?: string): ChatSession {
  const now = new Date().toISOString();
  const id = generateSessionId(agent.id);
  const rp = agent.config?.rolePrompt || '';
  return {
    id,
    agentId: agent.id,
    agentName: agent.name,
    title: `新会话 ${now.slice(11, 19)}`,
    messages: [],
    model: model || agent.model || '',
    systemPrompt: rp,
    masterPrompt: '',
    rolePrompt: rp,
    createdAt: now,
    updatedAt: now,
  };
}

export async function createSession(agent: Agent, model?: string): Promise<ChatSession> {
  const s = buildSession(agent, model);
  await saveSessionToFile(s);
  return s;
}

export async function getSessionsByAgent(agentId: string): Promise<ChatSession[]> {
  const raw = await indexReadCache.read(agentId, () => readJson<SessionMeta[] | string[]>(metaPath(agentId)));
  if (!raw || raw.length === 0) return [];
  const entries = raw as unknown[];
  const metas = new Map(
    entries.filter(isSessionMeta).map(meta => [meta.i, meta] as const),
  );
  const legacyIds = [...new Set(entries.filter((entry): entry is string => typeof entry === 'string'))]
    .filter(id => !metas.has(id));
  if (legacyIds.length > 0) {
    const loaded = await Promise.all(legacyIds.map(id => getSession(id)));
    for (const session of loaded) {
      if (session?.agentId === agentId) metas.set(session.id, toMeta(session));
    }
  }
  const result = [...metas.values()].map(meta => fromMeta(meta, agentId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (metas.size !== entries.length || legacyIds.length > 0) {
    writeJson(metaPath(agentId), result.map(toMeta)).catch(error => {
      console.error('[chat] 修复会话索引失败', error);
    });
  }
  return result;
}

export async function getSession(id: string): Promise<ChatSession | null> {
  const parts = id.split('-');
  if (parts.length < 3) return null;
  const agentId = `${parts[0]}-${parts[1]}`; // agent-xxx format
  const s = await readJson<ChatSession>(sessionPath(agentId, id));
  if (s) {
    if (!cache) cache = {};
    cache[s.id] = s;
    msgCache.set(s.id, s.messages);
  }
  return s;
}

export function getCachedMessages(sessionId: string): ChatMessage[] | undefined {
  return msgCache.get(sessionId);
}

/**
 * 标记会话为已读：lastReadAt 推进到当前时刻，存盘后 unreadCount 归零。
 * 用于切入 / 切走会话时。轻量、单一职责；与流式 saveSession 若并发，以最后写入为准，下次交互自校正。
 */
export async function markSessionRead(sessionId: string): Promise<void> {
  const s = await getSession(sessionId);
  if (!s) return;
  s.lastReadAt = new Date().toISOString();
  await saveSession(s);
}

export async function saveSession(session: ChatSession) {
  session.updatedAt = new Date().toISOString();
  session.unreadCount = computeUnread(session);
  msgCache.set(session.id, session.messages);
  await saveSessionToFile(session);

  // 维护 _index.json 元信息
  const mp = metaPath(session.agentId);
  indexReadCache.invalidate(session.agentId);
  const index = await readJson<SessionMeta[] | string[]>(mp) || [];
  if (index.length === 0 || typeof index[0] === 'string') {
    // 旧格式或无缓存：仍以旧格式维护 ID 列表，下次 getSessionsByAgent 时 migrate
    const legacy = (index as string[]).length ? index as string[] : [];
    if (!legacy.includes(session.id)) { legacy.push(session.id); await writeJson(mp, legacy); }
    return;
  }
  const arr = index as SessionMeta[];
  const idx = arr.findIndex(m => m.i === session.id);
  const meta = toMeta(session);
  if (idx >= 0) arr[idx] = meta; else arr.push(meta);
  await writeJson(mp, arr);
}

export async function deleteSession(id: string) {
  const parts = id.split('-');
  if (parts.length < 3) return;
  const agentId = `${parts[0]}-${parts[1]}`;
  await deleteFile(sessionPath(agentId, id));

  if (cache) delete cache[id];
  msgCache.delete(id);

  const mp = metaPath(agentId);
  indexReadCache.invalidate(agentId);
  const index = await readJson<SessionMeta[] | string[]>(mp);
  if (!index || index.length === 0) return;
  if (typeof index[0] === 'string') {
    await writeJson(mp, (index as string[]).filter(sid => sid !== id));
  } else {
    await writeJson(mp, (index as SessionMeta[]).filter(m => m.i !== id));
  }
}

export function autoTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user' && !m.content.startsWith('/'));
  if (firstUser) {
    const text = firstUser.content.replace(/\n/g, ' ').replace(/```[\s\S]*?```/g, '').trim().slice(0, 30);
    return text || '空会话';
  }
  return '空会话';
}

export async function getAllSessions(): Promise<ChatSession[]> {
  // This is expensive with file-based storage. Use the agent registry.
  // For dashboard stats, we need a lightweight way.
  const { getAgents } = await import('./agent');
  const agents = await getAgents();
  const all: ChatSession[] = [];
  for (const a of agents) {
    const sessions = await getSessionsByAgent(a.id);
    all.push(...sessions);
  }
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
