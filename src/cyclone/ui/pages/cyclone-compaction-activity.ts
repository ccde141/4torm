import { latestCompactionActivity, reduceCompactionActivity,
  type CompactionActivity } from '../../../components/common/compaction-activity';

/** Null records accepted input; an empty live stream must not resurrect the previous saved failure. */
export function reduceCycloneCompaction(current: CompactionActivity | null | undefined,
  event: { type?: unknown }): CompactionActivity | null | undefined {
  const next = reduceCompactionActivity(current ?? undefined, event);
  if (event.type === 'input-accepted' && !next) return null;
  return next ?? (current === null ? null : undefined);
}

export function visibleCycloneCompaction(live: CompactionActivity | null | undefined,
  stored: CompactionActivity | undefined, fallback?: CompactionActivity): CompactionActivity | undefined {
  return live === null ? undefined : latestCompactionActivity(live, stored) ?? fallback;
}
