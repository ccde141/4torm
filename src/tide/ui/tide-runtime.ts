import type { CollaborationProbeItem } from '../../api/collaboration';

export type TideRuntimeKind =
  | 'scheduled' | 'queued' | 'running' | 'waiting'
  | 'completed' | 'paused' | 'aborted' | 'failed' | 'crashed';

export interface TideRuntimeView {
  kind: TideRuntimeKind;
  active: boolean;
  error?: string;
}

interface TideTaskState {
  enabled: boolean;
  repeatCount: number;
  nextRun?: string;
}

export function visibleTideNextRun(task: TideTaskState): string | undefined {
  return !task.enabled || task.repeatCount === 0 ? undefined : task.nextRun;
}

export function reconcileSelectedTideTask<T extends { id: string }>(
  selected: T | null,
  tasks: T[],
): T | null {
  return selected ? tasks.find(task => task.id === selected.id) ?? null : null;
}

export function isOptimisticTideRun(manualRuns: Map<string, string | null>, taskId: string): boolean {
  return manualRuns.has(taskId) && manualRuns.get(taskId) === null;
}

const FAILURE_STATUSES = new Set(['aborted', 'failed', 'crashed']);

export function resolveTideRuntime(
  task: TideTaskState,
  probe: CollaborationProbeItem | undefined,
  optimistic: boolean,
): TideRuntimeView {
  if (optimistic) return { kind: 'queued', active: true };
  if (probe?.runId && FAILURE_STATUSES.has(probe.status)) {
    return { kind: probe.status as 'aborted' | 'failed' | 'crashed', active: false,
      ...(probe.errorMessage ? { error: probe.errorMessage } : {}) };
  }
  if (probe?.runId && ['queued', 'running', 'waiting'].includes(probe.status)) {
    return { kind: probe.status as 'queued' | 'running' | 'waiting', active: true };
  }
  if (task.repeatCount === 0) {
    return { kind: 'completed', active: false };
  }
  if (!task.enabled) return { kind: 'paused', active: false };
  return { kind: 'scheduled', active: false };
}

export async function waitForTideRun(
  taskId: string,
  runId: string,
  wait: (timeoutMs: number) => Promise<CollaborationProbeItem>,
  options: { timeoutMs: number },
): Promise<CollaborationProbeItem> {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const item = await wait(Math.min(30_000, Math.max(1, deadline - Date.now())));
    if (item.operationId !== taskId || item.runId !== runId) {
      throw new Error('潮汐运行身份不匹配');
    }
    if (item.status === 'completed') return item;
    if (FAILURE_STATUSES.has(item.status)) {
      throw new Error(item.errorMessage || `潮汐运行 ${item.status}`);
    }
    if (item.status !== 'queued' && item.status !== 'running' && item.status !== 'waiting') {
      throw new Error(`潮汐运行出现意外状态：${item.status}`);
    }
  }
  throw new Error('等待潮汐运行完成超时');
}
