import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { TokenUsage } from './llm-bridge.js';

export type ModelRequestPurpose = 'conversation' | 'compaction';
/** A read-only context preview; never a sent request or a billing observation. */
export interface CurrentInputEstimate {
  tokens: number;
  images: number;
  model: string;
  estimatedAt: string;
  basis?: 'compiled' | 'canonical';
  contextRevision?: string | number;
}
export interface ModelRequestUsage {
  id: string;
  purpose: ModelRequestPurpose;
  state: 'prepared' | 'sent' | 'streaming' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  updatedAt: string;
  estimatedInputTokens: number;
  imageCount: number;
  usage?: TokenUsage;
  usageComplete: boolean;
  /** False while waiting for a provider slot; cancellation there is not a sent request. */
  wasSent?: boolean;
}
export interface ModelUsageProgress {
  requests: Record<string, ModelRequestUsage>;
  calls: number;
  reportedCalls: number;
  total: TokenUsage;
  complete: boolean;
  latest?: ModelRequestUsage;
}
export interface ModelRequestUsageEvent { type: 'model-request'; request: ModelRequestUsage; }

const observers = new AsyncLocalStorage<((event: ModelRequestUsageEvent) => void) | undefined>();

/** An execution-local observation channel; feature owners retain persistence and identity. */
export function observeModelRequests<T>(emit: ((event: ModelRequestUsageEvent) => void) | undefined,
  run: () => Promise<T>, inherit = false): Promise<T> {
  const parent = inherit ? observers.getStore() : undefined;
  return observers.run(emit ? event => { parent?.(event); emit(event); } : parent, run);
}

export function createModelRequestUsage(body: Record<string, unknown>,
  purpose: ModelRequestPurpose = 'conversation') {
  const estimate = estimateRequestInput(body);
  let current: ModelRequestUsage = { id: randomUUID(), purpose, state: 'prepared',
    startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    estimatedInputTokens: estimate.tokens, imageCount: estimate.images, usageComplete: false, wasSent: false };
  const emit = observers.getStore();
  const publish = (patch: Partial<ModelRequestUsage>) => {
    current = { ...current, ...patch,
      updatedAt: new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString() };
    emit?.({ type: 'model-request', request: structuredClone(current) });
  };
  publish({});
  return {
    update: publish,
    report: (usage: TokenUsage) => publish({ state: 'streaming', usage: { ...usage } }),
    finish: (state: 'completed' | 'failed' | 'cancelled', usage?: TokenUsage, complete = Boolean(usage)) => publish({ state,
      ...(usage ? { usage: { ...usage } } : {}),
      usageComplete: state === 'completed' && complete && Boolean(usage ?? current.usage) }),
  };
}

/** Estimate the compiled input and tool schemas, never base64 or generation settings. */
export function estimateRequestInput(body: Record<string, unknown>): { tokens: number; images: number } {
  let images = 0;
  const project = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(project);
    if (!value || typeof value !== 'object') return value;
    const node = value as Record<string, unknown>;
    if (node.type === 'image_url' || node.type === 'image') { images++; return '[image]'; }
    return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, project(item)]));
  };
  const input = project({ messages: body.messages, system: body.system,
    tools: body.tools, tool_choice: body.tool_choice });
  let latin = 0;
  let wide = 0;
  for (const char of JSON.stringify(input)) {
    if (char.codePointAt(0)! > 0xff) wide++; else latin++;
  }
  return { tokens: Math.ceil(latin / 4 + wide) + images * 1_000, images };
}

/** Repeated streaming reports replace one request, so they cannot double its cost. */
export function recordModelRequest(previous: ModelUsageProgress | undefined,
  request: ModelRequestUsage): ModelUsageProgress {
  const prior = previous?.requests[request.id];
  if (prior && prior.updatedAt > request.updatedAt) return previous!;
  const requests = { ...previous?.requests, [request.id]: structuredClone(request) };
  return summarizeRequests(requests);
}

function summarizeRequests(requests: Record<string, ModelRequestUsage>): ModelUsageProgress {
  const values = Object.values(requests);
  const sent = values.filter(item => item.state !== 'prepared' && item.wasSent !== false);
  const reported = sent.filter(item => item.usage);
  const total = reported.reduce((sum, item) => ({
    promptTokens: sum.promptTokens + item.usage!.promptTokens,
    completionTokens: sum.completionTokens + item.usage!.completionTokens,
    totalTokens: sum.totalTokens + item.usage!.totalTokens,
  }), { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  const latest = values.filter(item => item.purpose === 'conversation')
    .reduce<ModelRequestUsage | undefined>((last, item) => !last || item.startedAt >= last.startedAt ? item : last, undefined);
  return { requests, calls: sent.length, reportedCalls: reported.length, total,
    complete: sent.every(item => item.usageComplete), ...(latest ? { latest } : {}) };
}

export function parseModelUsageProgress(value: unknown): ModelUsageProgress {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('模型请求计量无效');
  const requests = (value as { requests?: unknown }).requests;
  if (!requests || typeof requests !== 'object' || Array.isArray(requests)) throw new Error('模型请求计量无效');
  const parsed: Record<string, ModelRequestUsage> = {};
  for (const [id, item] of Object.entries(requests)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('模型请求计量无效');
    const entry = item as ModelRequestUsage;
    if (entry.id !== id || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(id)
      || !['conversation', 'compaction'].includes(entry.purpose)
      || !['prepared', 'sent', 'streaming', 'completed', 'failed', 'cancelled'].includes(entry.state)
      || !Number.isFinite(Date.parse(entry.startedAt)) || !Number.isFinite(Date.parse(entry.updatedAt))
      || !Number.isSafeInteger(entry.estimatedInputTokens) || entry.estimatedInputTokens < 0
      || !Number.isSafeInteger(entry.imageCount) || entry.imageCount < 0
      || typeof entry.usageComplete !== 'boolean') throw new Error('模型请求计量无效');
    if (entry.wasSent !== undefined && typeof entry.wasSent !== 'boolean') throw new Error('模型请求计量无效');
    if (entry.usage && ['promptTokens', 'completionTokens', 'totalTokens'].some(key => {
      const count = entry.usage![key as keyof TokenUsage];
      return !Number.isSafeInteger(count) || count < 0;
    })) {
      throw new Error('模型请求计量无效');
    }
    if (entry.usageComplete && (entry.state !== 'completed' || !entry.usage)) throw new Error('模型请求计量无效');
    parsed[id] = structuredClone(entry);
  }
  return summarizeRequests(parsed);
}
