import { backendFetch } from '../lib/backend-client';
import type { Agent, ChatMessage } from '../types';
import { getAgents } from './agent';
import { nameSessionOnce, requestSessionTitle, withSessionWrite } from './session-naming';
import type { TokenUsage } from './chat-token';
import { hydratePendingRuns, type PendingMonsoonRun } from '../engine/chat/pending-runs';
import { ChatMessageCache } from './chat-message-cache';

const BASE = '/api/conversation/sessions';

export interface ChatSession {
  id: string;
  agentId: string;
  agentName: string;
  title: string;
  titleManual?: boolean;
  titleState?: 'pending' | 'attempted' | 'generated';
  messages: ChatMessage[];
  model: string;
  systemPrompt: string;
  masterPrompt?: string;
  rolePrompt?: string;
  lastReadAt?: string;
  tokenUsage?: TokenUsage;
  modelUsage?: import('../lib/model-usage').ModelUsageProgress;
  currentInput?: import('../lib/model-usage').CurrentInputEstimate;
  createdAt: string;
  updatedAt: string;
  unreadCount?: number;
  revision?: number;
  messageRevision?: number;
}

// Identity lookups do not need to retain complete conversation snapshots.
const sessionAgents = new Map<string, string>();
const messages = new ChatMessageCache();

function nextId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function generateSessionId(agentId: string): string {
  return `${agentId}-${nextId()}`;
}

export function generateMessageId(): string {
  return `msg-${nextId()}`;
}

export function buildSession(agent: Agent, model?: string): ChatSession {
  if (typeof agent?.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(agent.id)) {
    throw new Error('Agent ID 无效');
  }
  const now = new Date().toISOString();
  const rolePrompt = agent.config?.rolePrompt || '';
  return {
    id: generateSessionId(agent.id), agentId: agent.id, agentName: agent.name,
    title: `新会话 ${now.slice(11, 19)}`, titleState: 'pending', messages: [],
    model: model || agent.model || '', systemPrompt: rolePrompt, masterPrompt: '', rolePrompt,
    createdAt: now, updatedAt: now, revision: 0,
  };
}

export async function createSession(agent: Agent, model?: string): Promise<ChatSession> {
  return create(buildSession(agent, model));
}

export async function getSessionsByAgent(agentId: string): Promise<ChatSession[]> {
  const response = await backendFetch(`${BASE}/${encodeURIComponent(agentId)}`);
  const result = await responseJson<ChatSession[]>(response, '读取会话列表失败');
  for (const session of result) remember(session, false);
  return result;
}

export async function getSession(id: string, knownAgentId?: string): Promise<ChatSession | null> {
  const session = await getSessionSnapshot(id, knownAgentId);
  if (session) remember(session);
  return session;
}

/** Read a fresh hydrated snapshot without changing the cached session. */
export async function getSessionSnapshot(id: string, knownAgentId?: string): Promise<ChatSession | null> {
  const agentId = knownAgentId ?? sessionAgents.get(id) ?? agentIdFromSessionId(id);
  const wire = await readSessionWire(agentId, id);
  if (!wire) return null;
  const { pendingRuns = [], ...stored } = wire;
  return pendingRuns.length ? hydratePendingRuns(stored, pendingRuns) : stored;
}

async function readSessionWire(agentId: string, id: string): Promise<
  (ChatSession & { pendingRuns?: PendingMonsoonRun[] }) | null
> {
  const response = await backendFetch(sessionUrl(agentId, id));
  if (response.status === 404) return null;
  return responseJson(response, '读取会话失败');
}

export function getCachedMessages(sessionId: string): ChatMessage[] | undefined {
  return messages.get(sessionId);
}

export async function previewSessionInput(agentId: string, sessionId: string, model: string) {
  const response = await backendFetch(`${sessionUrl(agentId, sessionId)}/input-preview`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }),
  });
  if (response.status === 404) return undefined;
  return await responseJson<import('../lib/model-usage').CurrentInputEstimate | null>(response,
    '预估当前上下文失败') ?? undefined;
}

export async function markSessionRead(sessionId: string): Promise<void> {
  const agentId = sessionAgents.get(sessionId) ?? agentIdFromSessionId(sessionId);
  await withSessionWrite(agentId, async () => {
    const wire = await readSessionWire(agentId, sessionId);
    if (!wire) return;
    const { pendingRuns = [], ...stored } = wire;
    // Reading is metadata: pending-run projections must never become another persisted copy.
    const saved = await replace({ ...stored, messages: [], lastReadAt: new Date().toISOString() },
      stored.revision ?? 0, 'read');
    remember(pendingRuns.length ? hydratePendingRuns(saved, pendingRuns) : saved);
  });
}

export async function saveSession(
  session: ChatSession,
  options: { rename?: boolean } = {},
): Promise<ChatSession> {
  return withSessionWrite(session.agentId, async () => {
    const revision = session.revision ?? 0;
    const saved = revision === 0
      ? await create(session)
      : await replace(session, revision, options.rename ? 'rename' : 'content');
    remember(saved);
    return saved;
  });
}

export async function deleteSession(id: string, knownAgentId?: string): Promise<void> {
  const agentId = knownAgentId ?? sessionAgents.get(id) ?? agentIdFromSessionId(id);
  await withSessionWrite(agentId, async () => {
    const response = await backendFetch(sessionUrl(agentId, id), { method: 'DELETE' });
    await responseJson(response, '删除会话失败');
    sessionAgents.delete(id); messages.delete(id);
  });
}

export async function nameCompletedSession(id: string): Promise<void> {
  const agentId = sessionAgents.get(id) ?? agentIdFromSessionId(id);
  await nameSessionOnce(id, {
    claim: () => withSessionWrite(agentId, async () => {
      const session = await getSession(id, agentId);
      if (!session || session.titleManual || session.titleState !== 'pending') return null;
      const user = session.messages.find(message => message.role === 'user' && message.content.trim());
      const assistant = findLast(session.messages,
        message => message.role === 'assistant' && !message.ask && !!message.content.trim());
      if (!user || !assistant) return null;
      await saveTitleState({ ...session, titleState: 'attempted' });
      return { model: session.model, user: user.content.slice(0, 2000),
        assistant: assistant.content.slice(0, 2000) };
    }),
    generate: requestSessionTitle,
    apply: (_sessionId, title) => withSessionWrite(agentId, async () => {
      const latest = await getSession(id, agentId);
      if (!latest || latest.titleManual || latest.titleState !== 'attempted') return;
      await saveTitleState({ ...latest, title, titleState: 'generated' });
    }),
  });
}

export async function getAllSessions(): Promise<ChatSession[]> {
  const all = await Promise.all((await getAgents()).map(agent => getSessionsByAgent(agent.id)));
  return all.flat().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

async function create(session: ChatSession): Promise<ChatSession> {
  const response = await backendFetch(BASE, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...session, revision: 0 }),
  });
  const saved = await responseJson<ChatSession>(response, '创建会话失败');
  remember(saved);
  return saved;
}

async function replace(
  session: ChatSession,
  expectedRevision: number,
  mode: 'content' | 'rename' | 'read',
): Promise<ChatSession> {
  const response = await backendFetch(sessionUrl(session.agentId, session.id), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision, mode, session: { ...session, revision: expectedRevision } }),
  });
  return responseJson<ChatSession>(response, '保存会话失败');
}

async function saveTitleState(session: ChatSession): Promise<void> {
  const revision = session.revision ?? 0;
  if (!revision) throw new Error('会话尚未持久化');
  remember(await replace(session, revision, 'rename'));
}

function remember(session: ChatSession, includeMessages = true): void {
  sessionAgents.set(session.id, session.agentId);
  if (includeMessages) messages.set(session.id, session.messages);
}

function sessionUrl(agentId: string, sessionId: string): string {
  return `${BASE}/${encodeURIComponent(agentId)}/${encodeURIComponent(sessionId)}`;
}

function agentIdFromSessionId(id: string): string {
  const parts = id.split('-');
  if (parts.length < 3) throw new Error('会话标识无效');
  return `${parts[0]}-${parts[1]}`;
}

async function responseJson<T>(response: Response, fallback: string): Promise<T> {
  const value = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(value.error || `${fallback}（HTTP ${response.status}）`);
  return value as T;
}

function findLast<T>(values: T[], predicate: (value: T) => boolean): T | undefined {
  for (let index = values.length - 1; index >= 0; index--) {
    if (predicate(values[index]!)) return values[index];
  }
  return undefined;
}
