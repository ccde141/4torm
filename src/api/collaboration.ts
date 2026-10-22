import { backendFetch } from '../lib/backend-client';
import { errorFromResponse } from './error-contract';

export type CollaborationFeature = 'monsoon' | 'convection' | 'cyclone' | 'tradewind' | 'tide';
export type CollaborationStatus =
  | 'idle' | 'queued' | 'running' | 'waiting'
  | 'completed' | 'aborted' | 'failed' | 'crashed';

export interface CollaborationProbeItem {
  operationId: string;
  title: string;
  status: CollaborationStatus;
  phase?: string;
  updatedAt?: string;
  agentId?: string;
  runId?: string;
  parentOperationId?: string;
  completedUnits?: number;
  totalUnits?: number;
  unit?: string;
  waitingReason?: string;
  errorCode?: string;
  errorMessage?: string;
  resultSummary?: string;
  schedule?: string;
  enabled?: boolean;
  artifactId?: string;
}

export interface ObservationQuery {
  view?: 'summary' | 'detail' | 'events';
  limit?: number;
  eventLimit?: number;
  maxTextChars?: number;
  maxTextLines?: number;
  cursor?: string;
  fields?: string[];
}

export interface ObservationEnvelope {
  schemaVersion: 1;
  feature: CollaborationFeature;
  view: 'summary' | 'detail' | 'events';
  revision: string;
  observedAt: string;
  completeness: 'complete' | 'partial';
  items: CollaborationProbeItem[];
  truncated: boolean;
  contentTruncated?: boolean;
  nextCursor?: string;
}

export interface CollaborationFeatureSnapshot {
  id: CollaborationFeature;
  version: number;
  title: string;
  methods: Array<{
    id: string;
    kind: 'query' | 'command';
    permission: 'observe' | 'design' | 'execute' | 'intervene' | 'administer';
    outputMode: 'inline' | 'operation' | 'artifact';
  }>;
  observation?: ObservationEnvelope;
  observationFailure?: { code: string; kind: string; message: string };
}

export interface CollaborationSnapshot {
  schemaVersion: 1;
  revision: string;
  observedAt: string;
  completeness: 'complete' | 'partial';
  features: CollaborationFeatureSnapshot[];
}

export interface OperationRecordSummary {
  operationId: string;
  runId: string;
  title: string;
  status: CollaborationStatus;
  timestamp: string;
  agentId?: string;
  agentIds?: string[];
  sessionId?: string;
  linkedSessionId?: string;
}

export interface OperationRecordPage {
  feature: CollaborationFeature;
  items: OperationRecordSummary[];
  truncated: boolean;
  nextCursor?: string;
}

export interface AgentLatestRecordPage {
  items: Array<{ agentId: string; feature: CollaborationFeature;
    record: OperationRecordSummary }>;
  failures: CollaborationFeature[];
}

export interface OperationRecordFragment {
  feature: CollaborationFeature;
  operationId: string;
  runId: string;
  format: 'json-fragment';
  text: string;
  truncated: boolean;
  nextCursor?: string;
}

export async function invokeFeature<T = unknown>(
  feature: CollaborationFeature,
  method: string,
  input: unknown,
  fallback?: string,
  options?: { signal?: AbortSignal },
): Promise<T> {
  const response = await backendFetch('/api/collaboration/invoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feature, method, input }),
    signal: options?.signal,
  });
  if (!response.ok) throw await errorFromResponse(response,
    fallback ? `${fallback} (HTTP ${response.status})` : `${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

export async function observeFeature(
  feature: CollaborationFeature,
  query: ObservationQuery,
): Promise<ObservationEnvelope> {
  const response = await backendFetch('/api/collaboration/observe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feature, query }),
  });
  if (!response.ok) throw await errorFromResponse(response, `${response.status} ${response.statusText}`);
  return response.json();
}

export async function readCollaborationSnapshot(
  query: Omit<ObservationQuery, 'cursor'>,
): Promise<CollaborationSnapshot> {
  const response = await backendFetch('/api/collaboration/snapshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw await errorFromResponse(response, `${response.status} ${response.statusText}`);
  return response.json();
}

export async function inspectOperation(
  feature: CollaborationFeature,
  operationId: string,
  runId: string,
): Promise<CollaborationProbeItem> {
  const response = await backendFetch('/api/collaboration/operation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feature, operationId, runId }),
  });
  if (!response.ok) throw await errorFromResponse(response, `${response.status} ${response.statusText}`);
  return response.json();
}

async function postCollaboration<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await backendFetch(`/api/collaboration/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal,
  });
  if (!response.ok) throw await errorFromResponse(response, `${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

export function waitOperation(
  feature: CollaborationFeature, operationId: string, runId: string,
  timeoutMs: number, signal?: AbortSignal,
): Promise<CollaborationProbeItem> {
  return postCollaboration('operation/wait', { feature, operationId, runId, timeoutMs }, signal);
}

export function findOperationRecords(
  feature: CollaborationFeature,
  query: { operationId?: string; agentId?: string; since?: string; until?: string; limit?: number; cursor?: string },
): Promise<OperationRecordPage> {
  return postCollaboration('records/find', { feature, ...query });
}

export function findLatestAgentRecords(agentIds: string[]): Promise<AgentLatestRecordPage> {
  return postCollaboration('records/agents/latest', { agentIds });
}

export function readOperationRecord(
  feature: CollaborationFeature, operationId: string, runId: string,
  query: { maxTextChars?: number; maxTextLines?: number; cursor?: string },
): Promise<OperationRecordFragment> {
  return postCollaboration('records/read', { feature, operationId, runId, ...query });
}

export async function observeAllFeature(
  feature: CollaborationFeature,
  query: ObservationQuery,
): Promise<CollaborationProbeItem[]> {
  const items: CollaborationProbeItem[] = [];
  const seen = new Set<string>();
  let cursor = query.cursor;
  while (true) {
    const page = await observeFeature(feature, { ...query, ...(cursor ? { cursor } : {}) });
    items.push(...page.items);
    if (!page.truncated) return items;
    if (!page.nextCursor || seen.has(page.nextCursor)) {
      throw new Error('中心状态观察返回了无效的分页游标');
    }
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}
