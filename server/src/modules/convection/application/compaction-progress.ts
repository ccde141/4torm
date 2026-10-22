import { randomUUID } from 'node:crypto';
import type { CompactionProgress } from '../../../engine/shared/compaction/contracts.js';
import { trackConvectionCompaction } from '../infrastructure/compaction-progress.js';
import type { ConvectionSessionData } from '../infrastructure/session-store.js';

export type ConvectionCompactionScope = 'public' | 'chair';
export type ConvectionCompactionSink = (sessionId: string, scope: ConvectionCompactionScope,
  event: CompactionProgress) => void;

export async function recordConvectionCompaction(session: ConvectionSessionData,
  scope: ConvectionCompactionScope, event: CompactionProgress,
  save: (next: ConvectionSessionData) => Promise<void>, emit?: ConvectionCompactionSink): Promise<void> {
  trackConvectionCompaction(event);
  const next = { ...session, [scope === 'public' ? 'compactionProgress' : 'chairCompactionProgress']: event };
  await save(next);
  Object.assign(session, next);
  publish(emit, session.id, scope, event);
}

/** Compression stages against a copy; only its successful atomic save changes the active history. */
export async function runConvectionContextChange<T>(session: ConvectionSessionData,
  scope: ConvectionCompactionScope, mode: 'clean' | 'summary',
  save: (next: ConvectionSessionData) => Promise<void>,
  run: (draft: ConvectionSessionData, completed: CompactionProgress) => Promise<T>, signal?: AbortSignal,
  emit?: ConvectionCompactionSink): Promise<T> {
  const startedAt = Date.now();
  const start: CompactionProgress = { type: 'compact-start', id: randomUUID(),
    operation: mode === 'clean' ? 'reset' : 'compact', reason: 'manual', startedAt, updatedAt: startedAt };
  const report = (event: CompactionProgress) => recordConvectionCompaction(session, scope, event, save, emit);
  try {
    signal?.throwIfAborted();
    await report(start);
    const completed: CompactionProgress = { ...start, type: 'compact-done', updatedAt: Date.now() };
    const result = await run(session, completed);
    // The completion is part of the content commit, so restart cannot mistake it for a pending change.
    trackConvectionCompaction(completed);
    publish(emit, session.id, scope, completed);
    return result;
  } catch (error) {
    await report({ ...start, type: 'compact-failed', updatedAt: Date.now(),
      aborted: signal?.aborted || (error instanceof Error && error.name === 'AbortError'),
      message: error instanceof Error ? error.message : String(error) }).catch(cause => {
        console.warn('[convection] compaction failure feedback could not be saved', { sessionId: session.id, scope }, cause);
      });
    throw error;
  }
}

function publish(emit: ConvectionCompactionSink | undefined, sessionId: string,
  scope: ConvectionCompactionScope, event: CompactionProgress): void {
  try { emit?.(sessionId, scope, event); } catch (error) {
    // Observers cannot undo committed history, but a lost notification must remain diagnosable.
    console.warn('[convection] compaction observer failed', { sessionId, scope, type: event.type }, error);
  }
}
