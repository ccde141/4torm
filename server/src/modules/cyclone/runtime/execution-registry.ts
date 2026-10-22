import { randomUUID } from 'node:crypto';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type {
  CycloneExecutionPort,
  CycloneExecutionSnapshot,
  CycloneExecutionTarget,
} from '../domain/operation-snapshot.js';
import { cycloneOperationId, type CycloneTargetKind } from '../domain/operation-snapshot.js';

type AcquireLock = (workshopId: string, targetId: string) => (() => void) | null;
type LockPorts = Pick<Record<CycloneTargetKind, AcquireLock>, 'seat' | 'room'>
  & Partial<Pick<Record<CycloneTargetKind, AcquireLock>, 'supervisor'>>;

interface ActiveExecution extends CycloneExecutionSnapshot {
  controller: AbortController;
  release: () => void;
}

export class CycloneExecutionRegistry implements CycloneExecutionPort {
  private readonly active = new Map<string, ActiveExecution>();

  constructor(private readonly locks: LockPorts) {}

  begin(target: CycloneExecutionTarget): CycloneExecutionSnapshot {
    const operationId = cycloneOperationId(target.targetKind, target.workshopId, target.targetId);
    const release = this.locks[target.targetKind]?.(target.workshopId, target.targetId);
    if (!release) throw executionError('CYCLONE_EXECUTION_BUSY', '目标正在处理其他任务');
    const entry: ActiveExecution = {
      ...target, operationId, runId: `cyclone-run-${randomUUID()}`,
      startedAt: new Date().toISOString(), controller: new AbortController(), release,
    };
    this.active.set(operationId, entry);
    return snapshotOf(entry);
  }

  finish(operationId: string, runId: string): void {
    const entry = this.current(operationId, runId);
    this.active.delete(operationId);
    entry.release();
  }

  abort(operationId: string, runId: string): void {
    this.current(operationId, runId).controller.abort();
  }

  signal(operationId: string, runId: string): AbortSignal {
    return this.current(operationId, runId).controller.signal;
  }

  list(): CycloneExecutionSnapshot[] {
    return [...this.active.values()].map(snapshotOf)
      .sort((left, right) => left.operationId.localeCompare(right.operationId));
  }

  private current(operationId: string, runId: string): ActiveExecution {
    const entry = this.active.get(operationId);
    if (!entry) throw executionError('CYCLONE_EXECUTION_NOT_RUNNING', '当前没有运行中的气旋执行', 'not_found');
    if (entry.runId !== runId) {
      throw executionError('CYCLONE_EXECUTION_CHANGED', '气旋执行已经变化，请刷新状态后重试');
    }
    return entry;
  }
}

function snapshotOf(entry: ActiveExecution): CycloneExecutionSnapshot {
  const { controller: _controller, release: _release, ...snapshot } = entry;
  return snapshot;
}

function executionError(code: string, message: string, kind: 'conflict' | 'not_found' = 'conflict') {
  return frameworkError({ code, kind, message, source: 'cyclone.executions', retryable: false });
}
