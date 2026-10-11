import { randomUUID } from 'node:crypto';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type {
  ConvectionRoundExecutionPort,
  ConvectionRoundKind,
  ConvectionRoundSnapshot,
} from '../domain/session-snapshot.js';

type AcquireLock = (sessionId: string) => (() => void) | null;

interface ActiveRoundEntry extends ConvectionRoundSnapshot {
  controller: AbortController;
  release: () => void;
}

export class ConvectionRoundRegistry implements ConvectionRoundExecutionPort {
  private readonly active = new Map<string, ActiveRoundEntry>();

  constructor(private readonly acquireLock: AcquireLock) {}

  begin(sessionId: string, round: ConvectionRoundKind): ConvectionRoundSnapshot {
    const release = this.acquireLock(sessionId);
    if (!release) throw roundError('CONVECTION_ROUND_BUSY', '该对流会话正在处理中');
    const entry: ActiveRoundEntry = {
      round, runId: `convection-run-${randomUUID()}`, startedAt: new Date().toISOString(),
      controller: new AbortController(), release,
    };
    this.active.set(sessionId, entry);
    return snapshotOf(entry);
  }

  finish(sessionId: string, runId: string): void {
    const entry = this.current(sessionId, runId);
    this.active.delete(sessionId);
    entry.release();
  }

  abort(sessionId: string, runId: string): void {
    this.current(sessionId, runId).controller.abort();
  }

  signal(sessionId: string, runId: string): AbortSignal {
    return this.current(sessionId, runId).controller.signal;
  }

  snapshot(sessionId: string): ConvectionRoundSnapshot | null {
    const entry = this.active.get(sessionId);
    return entry ? snapshotOf(entry) : null;
  }

  private current(sessionId: string, runId: string): ActiveRoundEntry {
    const entry = this.active.get(sessionId);
    if (!entry) throw roundError('CONVECTION_ROUND_NOT_RUNNING', '当前没有运行中的对流轮次', 'not_found');
    if (entry.runId !== runId) {
      throw roundError('CONVECTION_ROUND_CHANGED', '对流轮次已经变化，请刷新状态后重试');
    }
    return entry;
  }
}

function snapshotOf(entry: ActiveRoundEntry): ConvectionRoundSnapshot {
  return { round: entry.round, runId: entry.runId, startedAt: entry.startedAt };
}

function roundError(
  code: string,
  message: string,
  kind: 'conflict' | 'not_found' = 'conflict',
) {
  return frameworkError({
    code, kind, message, source: 'convection.rounds', retryable: false,
  });
}
