import type { Agent, ChatMessage } from '../types';
import { getAgents } from './agent';
import { nameSessionOnce, requestSessionTitle, withSessionWrite } from './session-naming';
import type { TokenUsage } from './chat-token';
import { hydratePendingRuns, type PendingMonsoonRun } from '../engine/chat/pending-runs';

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
  createdAt: string;
  updatedAt: string;
  unreadCount?: number;
  revision?: number;
  messageRevision?: number;
}

const sessions = new Map<string, ChatSession>();
const messages = new Map<string, ChatMessage[]>();

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
  const response = await fetch(`${BASE}/${encodeURIComponent(agentId)}`);
  const result = await responseJson<ChatSession[]>(response, '读取会话列表失败');
  for (const session of result) remember(session);
  return result;
}

export async function getSession(id: string, knownAgentId?: string): Promise<ChatSession | null> {
  const session = await getSessionSnapshot(id, knownAgentId);
  if (session) remember(session);
  return session;
}

/** Read a fresh hydrated snapshot without changing the cached session. */
export async function getSessionSnapshot(id: string, knownAgentId?: string): Promise<ChatSession | null> {
  const agentId = knownAgentId ?? sessions.get(id)?.agentId ?? agentIdFromSessionId(id);
  const response = await fetch(sessionUrl(agentId, id));
  if (response.status === 404) return null;
  const wire = await responseJson<ChatSession & { pendingRuns?: PendingMonsoonRun[] }>(
    response, '读取会话失败');
  const { pendingRuns = [], ...stored } = wire;
  return hydratePendingRuns(stored, pendingRuns);
}

export function getCachedMessages(sessionId: string): ChatMessage[] | undefined {
  return messages.get(sessionId);
}

export async function markSessionRead(sessionId: string): Promise<void> {
  const session = await getSession(sessionId);
  if (!session) return;
  await saveSession({ ...session, lastReadAt: new Date().toISOString() });
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
  const agentId = knownAgentId ?? sessions.get(id)?.agentId ?? agentIdFromSessionId(id);
  await withSessionWrite(agentId, async () => {
    const response = await fetch(sessionUrl(agentId, id), { method: 'DELETE' });
    await responseJson(response, '删除会话失败');
    sessions.delete(id); messages.delete(id);
  });
}

export async function nameCompletedSession(id: string): Promise<void> {
  const agentId = sessions.get(id)?.agentId ?? agentIdFromSessionId(id);
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
  const response = await fetch(BASE, {
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
  mode: 'content' | 'rename',
): Promise<ChatSession> {
  const response = await fetch(sessionUrl(session.agentId, session.id), {
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

function remember(session: ChatSession): void {
  const clone = structuredClone(session);
  sessions.set(session.id, clone);
  if (session.messages.length) messages.set(session.id, clone.messages);
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
