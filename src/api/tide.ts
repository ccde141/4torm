/**
 * 潮汐 — 前端 API 客户端
 *
 * 与后端 /api/tide/* 端点对应。
 */

const BASE = '/api/tide';

export type TidePushMode = 'accumulate' | 'designated';

export interface TideTask {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  agentId: string;
  repeatCount: number;
  pushMode: TidePushMode;
  targetSessionId?: string;
  windowN: number;
  roundSeq?: number;
  archiveBatch?: number;
  selfLoop: boolean;
  consecutiveErrors: number;
  enabled: boolean;
  createdAt: string;
  lastRun?: string;
  nextRun?: string;
}

export interface TideRunRecord {
  taskId: string;
  timestamp: string;
  status: 'success' | 'error';
  sessionId: string;
  answer: string;
  rawContent: string;
  toolCalls: { tool: string; args: Record<string, string>; result: string }[];
  turns: number;
  durationMs: number;
  error?: string;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function listTasks(): Promise<TideTask[]> {
  return jsonOrThrow(await fetch(`${BASE}/tasks`));
}

export async function getTaskDetail(taskId: string): Promise<{ task: TideTask; recent: TideRunRecord[] }> {
  return jsonOrThrow(await fetch(`${BASE}/task/${taskId}`));
}

export interface CreateTaskInput {
  name: string;
  schedule: string;
  prompt: string;
  agentId: string;
  repeatCount?: number;
  pushMode?: TidePushMode;
  targetSessionId?: string;
  windowN?: number;
  selfLoop?: boolean;
}

export async function createTask(input: CreateTaskInput): Promise<TideTask> {
  return jsonOrThrow(await fetch(`${BASE}/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }));
}

export async function updateTask(taskId: string, patch: Partial<TideTask>): Promise<TideTask> {
  return jsonOrThrow(await fetch(`${BASE}/task/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }));
}

export async function deleteTask(taskId: string): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/task/${taskId}`, { method: 'DELETE' }));
}

export async function toggleTask(taskId: string): Promise<TideTask> {
  return jsonOrThrow(await fetch(`${BASE}/task/${taskId}/toggle`, { method: 'POST' }));
}

export async function runNow(taskId: string): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/task/${taskId}/run-now`, { method: 'POST' }));
}

export async function listRuns(taskId: string, limit = 20): Promise<TideRunRecord[]> {
  return jsonOrThrow(await fetch(`${BASE}/task/${taskId}/runs?limit=${limit}`));
}

// ── 会话内容 ────────────────────────────────────────────────────

export interface TideSession {
  id: string;
  agentId: string;
  agentName: string;
  title: string;
  messages: Array<{ id: string; role: string; content: string; timestamp?: string }>;
  model: string;
  systemPrompt: string;
  createdAt: string;
  updatedAt: string;
}

export interface TideSessionSummary {
  id: string; agentId: string; agentName: string;
  title: string; model: string;
  messageCount: number;
  createdAt: string; updatedAt: string;
}

export async function listTideSessions(agentId: string): Promise<TideSessionSummary[]> {
  return jsonOrThrow(await fetch(`${BASE}/sessions/${agentId}`));
}

export async function deleteTideSession(taskId: string): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/session/${taskId}`, { method: 'DELETE' }));
}

export async function getTideSession(agentId: string, sessionId: string): Promise<TideSession> {
  return jsonOrThrow(await fetch(`${BASE}/session/${agentId}/${sessionId}`));
}
