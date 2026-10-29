/**
 * 潮汐 — 前端 API 客户端
 *
 * 与后端 /api/tide/* 端点对应。
 */

import { backendFetch } from '../lib/backend-client';
import { errorFromResponse } from './error-contract';
import { invokeFeature } from './collaboration';
import type { ToolImageRef } from '../engine/tool-media';

const BASE = '/api/tide';

export type TidePushMode = 'accumulate' | 'designated';

export interface TideTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TideUsageProgress {
  modelUsage?: import('../lib/model-usage').ModelUsageProgress;
  calls: number;
  reportedCalls: number;
  latest?: TideTokenUsage;
  total?: TideTokenUsage;
}

export interface TideRunState {
  runId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'aborted' | 'crashed';
  usage?: TideUsageProgress;
  compactionNotice?: string;
  compaction?: TideCompactionProgress;
}

export interface TideCompactionProgress {
  type: 'compact-start' | 'compact-done' | 'compact-failed';
  id: string;
  operation: 'compact' | 'reset';
  startedAt: number;
  updatedAt: number;
  reason: 'manual' | 'threshold' | 'provider-overflow';
  message?: string;
  aborted?: boolean;
  summaryLength?: number;
  archivedMessages?: number;
}

export interface TideTask {
  currentInput?: import('../lib/model-usage').CurrentInputEstimate;
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
  runId?: string;
  timestamp: string;
  status: 'success' | 'error' | 'aborted';
  sessionId: string;
  pushMode?: TidePushMode;
  agentId?: string;
  sessionState?: 'retained' | 'archived';
  answer: string;
  rawContent: string;
  toolCalls: { tool: string; args: Record<string, unknown>; result: string; toolImages?: ToolImageRef[] }[];
  turns: number;
  durationMs: number;
  error?: string;
  usage?: TideUsageProgress;
  notices?: string[];
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw await errorFromResponse(res, `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function listTasks(): Promise<TideTask[]> {
  return jsonOrThrow(await backendFetch(`${BASE}/tasks`));
}

export async function getTaskDetail(taskId: string): Promise<{
  task: TideTask; recent: TideRunRecord[]; runState?: TideRunState | null;
}> {
  return jsonOrThrow(await backendFetch(`${BASE}/task/${taskId}`));
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
  const result = await invokeFeature<{ task: TideTask }>('tide', 'createTask', input);
  return result.task;
}

export async function updateTask(taskId: string, patch: Partial<TideTask>): Promise<TideTask> {
  const result = await invokeFeature<{ task: TideTask }>('tide', 'updateTask', { taskId, patch });
  return result.task;
}

export async function deleteTask(taskId: string): Promise<void> {
  await invokeFeature('tide', 'deleteTask', { taskId });
}

export async function toggleTask(taskId: string): Promise<TideTask> {
  const result = await invokeFeature<{ task: TideTask }>('tide', 'toggleTask', { taskId });
  return result.task;
}

export interface TideRunReceipt {
  ok: true;
  accepted: true;
  runId: string;
}

export async function runNow(taskId: string): Promise<TideRunReceipt> {
  const result = await invokeFeature<{ accepted: true; runId: string }>('tide', 'runTask', { taskId });
  return { ok: true, accepted: result.accepted, runId: result.runId };
}

export async function listRuns(taskId: string, limit = 20): Promise<TideRunRecord[]> {
  return jsonOrThrow(await backendFetch(`${BASE}/task/${taskId}/runs?limit=${limit}`));
}

// ── 会话内容 ────────────────────────────────────────────────────

export interface TideSession {
  currentInput?: import('../lib/model-usage').CurrentInputEstimate;
  id: string;
  agentId: string;
  agentName: string;
  title: string;
  messages: Array<{ id: string; role: string; content: string; timestamp?: string; toolImages?: ToolImageRef[];
    type?: 'compact-marker'; contextOnly?: boolean; nativeContext?: Array<{ role: string; content: string; toolCallId?: string;
      toolOk?: boolean; toolImages?: ToolImageRef[]; toolCalls?: Array<{ id: string; name: string; arguments: string }> }> }>;
  model: string;
  systemPrompt: string;
  createdAt: string;
  updatedAt: string;
  tokenUsage?: TideTokenUsage;
  usage?: TideUsageProgress;
  compaction?: TideCompactionProgress;
  compactionNotice?: string;
}

export interface TideSessionSummary {
  id: string; agentId: string; agentName: string;
  title: string; model: string;
  messageCount: number;
  createdAt: string; updatedAt: string;
}

export async function listTideSessions(agentId: string): Promise<TideSessionSummary[]> {
  return jsonOrThrow(await backendFetch(`${BASE}/sessions/${agentId}`));
}

export async function deleteTideSession(taskId: string): Promise<void> {
  await invokeFeature('tide', 'deleteSession', { taskId });
}

export async function getTideSession(agentId: string, sessionId: string): Promise<TideSession> {
  return jsonOrThrow(await backendFetch(`${BASE}/session/${agentId}/${sessionId}`));
}

export function compactTideSession(agentId: string, sessionId: string, signal?: AbortSignal): Promise<{
  compacted: boolean; notices: string[]; updatedAt: number;
}> {
  return invokeFeature('tide', 'compactSession', { agentId, sessionId }, undefined, { signal });
}
