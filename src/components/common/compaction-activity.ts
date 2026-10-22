export interface CompactionActivity {
  id: string;
  phase: 'running' | 'completed' | 'failed' | 'cancelled';
  operation: 'compact' | 'reset';
  startedAt: number;
  updatedAt: number;
  message?: string;
}

/** A scoped runtime fact, separate from both transcript messages and model fallback notices. */
export function compactionActivity(event: unknown): CompactionActivity | undefined {
  if (!event || typeof event !== 'object' || !('type' in event)) return;
  const value = event as Record<string, unknown>;
  if (!['compact-start', 'compact-done', 'compact-failed'].includes(String(value.type))) return;
  const now = Date.now();
  const startedAt = typeof value.startedAt === 'number' && Number.isFinite(value.startedAt) ? value.startedAt : now;
  const updatedAt = typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? value.updatedAt : startedAt;
  return { id: typeof value.id === 'string' ? value.id : `legacy-${startedAt}`,
    phase: value.type === 'compact-start' ? 'running' : value.type === 'compact-done' ? 'completed'
      : value.aborted === true ? 'cancelled' : 'failed',
    operation: value.operation === 'reset' ? 'reset' : 'compact', startedAt, updatedAt,
    ...(typeof value.message === 'string' ? { message: value.message } : {}) };
}

export function reduceCompactionActivity(current: CompactionActivity | undefined,
  event: unknown): CompactionActivity | undefined {
  const next = compactionActivity(event);
  if (next) {
    // Browser and server clocks may differ; an admitted backend fact replaces local optimism.
    if (current?.id.startsWith('pending-') && !next.id.startsWith('pending-')) return next;
    if (current && next.updatedAt < current.updatedAt) return current;
    if (current?.phase === 'running' && next.id !== current.id && next.phase !== 'running') return current;
    if (current && next.id === current.id && current.phase !== 'running' && next.phase === 'running') return current;
    return next;
  }
  if (!event || typeof event !== 'object' || !('type' in event)) return current;
  if (event.type === 'input-accepted' && current?.phase !== 'running') return;
  // Missing terminal transport events cannot leave an endless spinner after a stopped run.
  if (current?.phase === 'running' && (event.type === 'error' || event.type === 'aborted')) {
    // A transport abort alone cannot establish whether the durable commit completed.
    return { ...current, phase: 'failed', updatedAt: Date.now(),
      message: 'message' in event && typeof event.message === 'string' ? event.message : undefined };
  }
  return current;
}

export function compactionActivityVisible(activity: CompactionActivity | undefined, now = Date.now()): boolean {
  return !!activity && (activity.phase === 'running' || activity.phase === 'failed'
    || now - activity.updatedAt < 4000);
}

export function latestCompactionActivity(...activities: Array<CompactionActivity | undefined>): CompactionActivity | undefined {
  return activities.filter((activity): activity is CompactionActivity => !!activity)
    .sort((a, b) => b.updatedAt - a.updatedAt || Number(a.phase === 'running') - Number(b.phase === 'running'))[0];
}
