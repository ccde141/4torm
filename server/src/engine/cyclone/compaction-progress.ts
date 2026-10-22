import { randomUUID } from 'node:crypto';
import type { CompactionProgress } from '../shared/compaction/index.js';

export function startCycloneCompaction(operation: 'compact' | 'reset' = 'compact'): CompactionProgress {
  const now = Date.now();
  return { type: 'compact-start', id: randomUUID(), operation, startedAt: now, updatedAt: now, reason: 'manual' };
}

export function finishCycloneCompaction(progress: CompactionProgress, error?: unknown, aborted = false): CompactionProgress {
  return { ...progress, type: error ? 'compact-failed' : 'compact-done', updatedAt: Date.now(),
    ...(error ? { aborted, message: error instanceof Error ? error.message : String(error) } : {}) };
}

/** A persisted start without a live owner is an interrupted attempt, never a resumable write. */
export function recoveredCycloneCompaction(progress: CompactionProgress | undefined, running: boolean): CompactionProgress | undefined {
  return progress?.type === 'compact-start' && !running
    ? { ...progress, type: 'compact-failed', aborted: true, message: '压缩未完成，原会话保留' } : progress;
}
