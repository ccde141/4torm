import type { CompactionProgress } from '../../../engine/shared/compaction/index.js';
import { finishCycloneCompaction, startCycloneCompaction } from '../../../engine/cyclone/compaction-progress.js';

/** The island's primary-file replacement, not summary generation, owns completion. */
export async function withCycloneContextChange<T>(operation: 'compact' | 'reset',
  signal: AbortSignal | undefined, report: (progress: CompactionProgress) => Promise<void>,
  commit: (started: CompactionProgress) => Promise<T>): Promise<T> {
  signal?.throwIfAborted();
  const started = startCycloneCompaction(operation);
  await report(started);
  try {
    const result = await commit(started);
    // The commit stores completion alongside the new context; a notification failure cannot undo it.
    return result;
  } catch (error) {
    await report(finishCycloneCompaction(started, error, signal?.aborted))
      .catch(cause => console.warn('[cyclone] compaction failure feedback could not be saved', cause));
    throw error;
  }
}
