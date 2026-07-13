/**
 * Agent 长期记忆 — 前端 API 客户端
 *
 * 与后端 /api/memory/* 端点对应。供控制台记忆面板查看/编辑 agent 记忆。
 */

const BASE = '/api/memory';

export type MemoryCategory = 'feedback' | 'fact' | 'pitfall' | 'reference';

export interface MemoryEntry {
  slug: string;
  category: MemoryCategory;
  tags: string[];
  summary: string;
  detail: string;
  created: string;
  updated: string;
  hits: number;
  source: string;
  summaryPending: boolean;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function listMemory(agentId: string): Promise<MemoryEntry[]> {
  return jsonOrThrow(await fetch(`${BASE}/list?agentId=${encodeURIComponent(agentId)}`));
}

// 人只对 detail 负责；summary 由系统生成/AI 精炼，不进人类草稿。
// tags 为可选高级项。
export interface MemoryDraft {
  detail: string;
  category: MemoryCategory;
  tags: string[];
}

export async function createMemory(agentId: string, draft: MemoryDraft): Promise<{ slug: string }> {
  return jsonOrThrow(await fetch(`${BASE}/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, ...draft }),
  }));
}

export async function updateMemory(agentId: string, slug: string, patch: Partial<MemoryDraft>): Promise<MemoryEntry> {
  return jsonOrThrow(await fetch(`${BASE}/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, slug, ...patch }),
  }));
}

export async function deleteMemory(agentId: string, slug: string): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, slug }),
  }));
}
