import { randomUUID } from 'node:crypto';
import type { ObservationScope } from './execution-observation-contract.js';

export type BackgroundExecutionStatus =
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface BackgroundExecutionInput {
  executionId?: string;
  scope: ObservationScope;
  ownerId: string;
  label: string;
  graceMs?: number;
  run: (signal: AbortSignal) => Promise<string>;
  onSettled?: (snapshot: BackgroundExecutionSnapshot) => void;
}

export interface BackgroundExecutionSnapshot {
  executionId: string;
  scope: ObservationScope;
  ownerId: string;
  label: string;
  status: BackgroundExecutionStatus;
  startedAt: number;
  finishedAt?: number;
  result?: string;
  error?: string;
  exitCode?: number | null;
}

export interface BackgroundExecutionCoordinatorOptions {
  /** 终态结果保留时间，供 Agent 在后续轮次查询。 */
  retentionMs?: number;
  /** 最多保留的终态结果数量；运行中的任务不会被回收。 */
  maxEntries?: number;
  now?: () => number;
}

type Entry = BackgroundExecutionSnapshot & {
  controller: AbortController;
  settled: Promise<void>;
};

const TERMINAL = new Set<BackgroundExecutionStatus>(['completed', 'failed', 'cancelled']);
const DEFAULT_RETENTION_MS = 30 * 60_000;
const DEFAULT_MAX_ENTRIES = 500;

/**
 * 持有超过单次 HTTP 请求或 ReAct 工具调用寿命的执行。
 * 它只提供稳定句柄，不会在任务结束时主动唤醒模型。
 */
export class BackgroundExecutionCoordinator {
  private readonly entries = new Map<string, Entry>();
  private readonly retentionMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: BackgroundExecutionCoordinatorOptions = {}) {
    this.retentionMs = Math.max(0, options.retentionMs ?? DEFAULT_RETENTION_MS);
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.now = options.now ?? Date.now;
  }

  async start(input: BackgroundExecutionInput): Promise<BackgroundExecutionSnapshot> {
    this.prune();
    const executionId = input.executionId ?? randomUUID();
    if (this.entries.has(executionId)) throw new Error('execution already exists');

    const controller = new AbortController();
    const entry: Entry = {
      executionId,
      scope: input.scope,
      ownerId: input.ownerId,
      label: input.label,
      status: 'running',
      startedAt: this.now(),
      controller,
      settled: Promise.resolve(),
    };
    this.entries.set(executionId, entry);
    entry.settled = this.run(entry, input.run, input.onSettled);

    await waitAtMost(entry.settled, Math.max(0, input.graceMs ?? 3_000));
    return this.snapshot(entry);
  }

  inspect(executionId: string, scope: ObservationScope, ownerId: string): BackgroundExecutionSnapshot | undefined {
    this.prune();
    const entry = this.owned(executionId, scope, ownerId);
    return entry ? this.snapshot(entry) : undefined;
  }

  async wait(
    executionId: string,
    scope: ObservationScope,
    ownerId: string,
    timeoutMs = 10_000,
  ): Promise<BackgroundExecutionSnapshot> {
    this.prune();
    const entry = this.owned(executionId, scope, ownerId);
    if (!entry) throw new Error('execution not found');
    await waitAtMost(entry.settled, Math.max(0, Math.min(30_000, timeoutMs)));
    return this.snapshot(entry);
  }

  async terminate(executionId: string, scope: ObservationScope, ownerId: string): Promise<boolean> {
    this.prune();
    const entry = this.owned(executionId, scope, ownerId);
    if (!entry || TERMINAL.has(entry.status) || entry.status === 'cancelling') return false;
    entry.status = 'cancelling';
    entry.controller.abort();
    return true;
  }

  /** 服务退出时终止并等待所有后台执行收口，避免遗留子进程。 */
  async shutdown(): Promise<void> {
    const active = [...this.entries.values()].filter(entry => !TERMINAL.has(entry.status));
    for (const entry of active) {
      if (entry.status !== 'cancelling') entry.status = 'cancelling';
      entry.controller.abort();
    }
    await Promise.all(active.map(entry => entry.settled));
  }

  private async run(
    entry: Entry,
    run: BackgroundExecutionInput['run'],
    onSettled?: BackgroundExecutionInput['onSettled'],
  ): Promise<void> {
    try {
      entry.result = await run(entry.controller.signal);
      entry.status = entry.controller.signal.aborted ? 'cancelled' : 'completed';
    } catch (error) {
      if (entry.controller.signal.aborted) entry.status = 'cancelled';
      else {
        entry.status = 'failed';
        entry.error = error instanceof Error ? error.message : String(error);
        entry.exitCode = readExitCode(error);
      }
    } finally {
      entry.finishedAt = this.now();
      try { onSettled?.(this.snapshot(entry)); } catch { /* 观察回调不能改变执行终态 */ }
      this.prune();
    }
  }

  private owned(executionId: string, scope: ObservationScope, ownerId: string): Entry | undefined {
    const entry = this.entries.get(executionId);
    return entry && entry.scope === scope && entry.ownerId === ownerId ? entry : undefined;
  }

  private snapshot(entry: Entry): BackgroundExecutionSnapshot {
    const { controller: _controller, settled: _settled, ...snapshot } = entry;
    return { ...snapshot };
  }

  private prune(): void {
    const now = this.now();
    for (const [id, entry] of this.entries) {
      if (TERMINAL.has(entry.status) && entry.finishedAt !== undefined && now - entry.finishedAt >= this.retentionMs) {
        this.entries.delete(id);
      }
    }

    const terminal = [...this.entries.values()]
      .filter(entry => TERMINAL.has(entry.status))
      .sort((a, b) => (a.finishedAt ?? a.startedAt) - (b.finishedAt ?? b.startedAt));
    const overflow = this.entries.size - this.maxEntries;
    for (let index = 0; index < overflow && index < terminal.length; index += 1) {
      this.entries.delete(terminal[index].executionId);
    }
  }
}

function readExitCode(error: unknown): number | null | undefined {
  if (!(error instanceof Error) || !('exitCode' in error)) return undefined;
  const exitCode = (error as Error & { exitCode?: unknown }).exitCode;
  return typeof exitCode === 'number' || exitCode === null ? exitCode : undefined;
}

function waitAtMost(promise: Promise<void>, timeoutMs: number): Promise<void> {
  if (timeoutMs === 0) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(resolve, timeoutMs);
    promise.finally(() => {
      clearTimeout(timer);
      resolve();
    }).catch(() => { /* run() 会吸收执行异常 */ });
  });
}

export const backgroundExecutions = new BackgroundExecutionCoordinator();

export function formatExecutionSnapshot(snapshot: BackgroundExecutionSnapshot): string {
  const lines = [
    `执行句柄：${snapshot.executionId}`,
    `状态：${snapshot.status}`,
    `任务：${snapshot.label}`,
  ];
  if (snapshot.result) lines.push(`结果：${snapshot.result}`);
  if (snapshot.error) lines.push(`错误：${snapshot.error}`);
  return lines.join('\n');
}
