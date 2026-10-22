import type { CompactionProgress } from '../../../engine/shared/compaction/contracts.js';

const active = new Set<string>();

/** A persisted start is only running while this process still owns its compression. */
export function trackConvectionCompaction(event: CompactionProgress): void {
  if (event.type === 'compact-start') active.add(event.id);
  else active.delete(event.id);
}

export function recoverConvectionCompaction(event: CompactionProgress | undefined): CompactionProgress | undefined {
  if (!event || event.type !== 'compact-start' || active.has(event.id)) return event;
  return { ...event, type: 'compact-failed', updatedAt: Date.now(), aborted: true,
    message: '压缩已中断，原始记录已保留' };
}
