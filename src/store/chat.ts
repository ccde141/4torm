import { readJson, writeJson, ensureDir, deleteFile } from '../api/storage';
import type { Agent, ChatMessage } from '../types';

export interface ChatSession {
  id: string;
  agentId: string;
  agentName: string;
  title: string;
  messages: ChatMessage[];
  model: string;
  systemPrompt: string;
  masterPrompt?: string;
  rolePrompt?: string;
  lastReadAt?: string;
  createdAt: string;
  updatedAt: string;
}

function sessionPath(agentId: string, sessionId: string): string {
  return `agents/${agentId}/sessions/${sessionId}.json`;
}

let cache: Record<string, ChatSession> | null = null;

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

export async function createSession(agent: Agent, model?: string): Promise<ChatSession> {
  const now = new Date().toISOString();
  const id = generateSessionId(agent.id);
  const rp = agent.config?.rolePrompt || '';
  const s: ChatSession = {
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
  await saveSessionToFile(s);
  return s;
}

export async function getSessionsByAgent(agentId: string): Promise<ChatSession[]> {
  // We can't easily list directory from browser, so we need the registry.
  // For now, sessions are loaded on-demand. We need a sessions index.
  // Let's use a separate sessions index file.
  const index = await readJson<string[]>(`agents/${agentId}/sessions/_index.json`);
  if (!index) return [];
  const result: ChatSession[] = [];
  for (const sid of index) {
    const s = await getSession(sid);
    if (s && s.agentId === agentId) result.push(s);
  }
  return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getSession(id: string): Promise<ChatSession | null> {
  const parts = id.split('-');
  if (parts.length < 3) return null;
  const agentId = `${parts[0]}-${parts[1]}`; // agent-xxx format
  const s = await readJson<ChatSession>(sessionPath(agentId, id));
  if (s) {
    if (!cache) cache = {};
    cache[s.id] = s;
  }
  return s;
}

export async function saveSession(session: ChatSession) {
  session.updatedAt = new Date().toISOString();
  await saveSessionToFile(session);

  const indexPath = `agents/${session.agentId}/sessions/_index.json`;
  const index = await readJson<string[]>(indexPath) || [];
  if (!index.includes(session.id)) {
    index.push(session.id);
    await writeJson(indexPath, index);
  }
}

export async function deleteSession(id: string) {
  const parts = id.split('-');
  if (parts.length < 3) return;
  const agentId = `${parts[0]}-${parts[1]}`;
  await deleteFile(sessionPath(agentId, id));

  if (cache) delete cache[id];

  const indexPath = `agents/${agentId}/sessions/_index.json`;
  const index = await readJson<string[]>(indexPath) || [];
  await writeJson(indexPath, index.filter(sid => sid !== id));
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
