import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../../shared/atomic-io.js';
import type { TokenUsage } from '../../shared/llm-bridge.js';
import { observeModelRequests, recordModelRequest, parseModelUsageProgress, type ModelRequestUsage, type ModelRequestUsageEvent,
  type ModelUsageProgress } from '../../shared/model-request-usage.js';

export interface TokenUsageProgress {
  calls: number;
  reportedCalls: number;
  latest: TokenUsage | null;
  total: TokenUsage;
  modelUsage?: ModelUsageProgress;
}

const zero: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
const empty: TokenUsageProgress = { calls: 0, reportedCalls: 0, latest: null, total: zero };

export class TokenUsageRecorder {
  private current: TokenUsageProgress = empty;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly file?: string) {}

  get state(): TokenUsageProgress { return this.current; }

  recordRequest(request: ModelRequestUsage): Promise<void> {
    const next = this.pending.then(async () => {
      const progress = { ...this.current, modelUsage: recordModelRequest(this.current.modelUsage, request) };
      if (this.file) {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        await atomicWriteFile(this.file, JSON.stringify(progress));
      }
      this.current = progress;
    });
    this.pending = next;
    return next;
  }

  flush(): Promise<unknown> { return this.pending; }

  /** Context reset invalidates the last input measurement without inventing a model call. */
  clearPromptMeasurement(): Promise<void> {
    const next = this.pending.then(async () => {
      const progress = { ...this.current, latest: null };
      if (this.file) await atomicWriteFile(this.file, JSON.stringify(progress));
      this.current = progress;
    });
    this.pending = next;
    return next;
  }

  record(usage: TokenUsage | null): Promise<TokenUsageProgress> {
    const next = this.pending.then(async () => {
      const progress = advance(this.current, usage);
      if (this.file) {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        await atomicWriteFile(this.file, JSON.stringify(progress));
      }
      this.current = progress;
      return progress;
    });
    this.pending = next;
    return next;
  }
}

/** Record an unknown attempt before shared ReAct emits usage:null for a rejected call. */
export async function captureTokenUsage<T extends { usage?: TokenUsage }>(
  call: () => Promise<T>, record: (usage: TokenUsage | null) => Promise<unknown>,
  onRequest?: (event: ModelRequestUsageEvent) => void,
): Promise<T> {
  return observeModelRequests(onRequest, async () => {
    let result: T;
    try { result = await call(); }
    catch (error) {
      await record(null);
      throw error;
    }
    await record(result.usage ?? null);
    return result;
  }, onRequest === undefined);
}

function advance(previous: TokenUsageProgress, usage: TokenUsage | null): TokenUsageProgress {
  if (usage !== null) validateUsage(usage);
  return {
    ...previous,
    calls: previous.calls + 1,
    reportedCalls: previous.reportedCalls + (usage ? 1 : 0),
    latest: usage,
    total: usage ? {
      promptTokens: previous.total.promptTokens + usage.promptTokens,
      completionTokens: previous.total.completionTokens + usage.completionTokens,
      totalTokens: previous.total.totalTokens + usage.totalTokens,
    } : previous.total,
  };
}

function validateUsage(value: unknown): asserts value is TokenUsage {
  if (!value || typeof value !== 'object') throw new Error('信风 token 用量格式无效');
  const usage = value as Record<string, unknown>;
  for (const key of ['promptTokens', 'completionTokens', 'totalTokens']) {
    if (!Number.isSafeInteger(usage[key]) || (usage[key] as number) < 0) {
      throw new Error('信风 token 用量格式无效');
    }
  }
}

export async function readTokenUsageFile(file: string): Promise<TokenUsageProgress | undefined> {
  let raw: string;
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('信风 token 用量记录不是常规文件');
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('信风 token 用量记录格式无效');
  const progress = value as Record<string, unknown>;
  if (!Number.isSafeInteger(progress.calls) || !Number.isSafeInteger(progress.reportedCalls)
    || (progress.calls as number) < 0 || (progress.reportedCalls as number) < 0
    || (progress.reportedCalls as number) > (progress.calls as number)) {
    throw new Error('信风 token 用量记录格式无效');
  }
  if (progress.latest !== null) validateUsage(progress.latest);
  validateUsage(progress.total);
  if (progress.modelUsage !== undefined) progress.modelUsage = parseModelUsageProgress(progress.modelUsage);
  return progress as unknown as TokenUsageProgress;
}
