import { useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { compactionActivityVisible, type CompactionActivity } from './compaction-activity';

/** Transient status lives beside the composer, never in the saved conversation. */
export function CompactionStatus({ activity }: { activity?: CompactionActivity }) {
  const { t } = useLocale();
  const [, refresh] = useState(0);
  const phase = activity?.phase;
  const updatedAt = activity?.updatedAt;
  useEffect(() => {
    if (updatedAt === undefined || phase === 'running' || phase === 'failed') return;
    const remaining = 4000 - (Date.now() - updatedAt);
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => refresh(value => value + 1), remaining);
    return () => window.clearTimeout(timer);
  }, [phase, updatedAt]);
  if (!activity || !compactionActivityVisible(activity)) return null;
  const key = activity.phase === 'running'
    ? activity.operation === 'reset' ? 'compaction.status.resetting' : 'compaction.status.running'
    : activity.phase === 'completed'
      ? activity.operation === 'reset' ? 'compaction.status.reset' : 'compaction.status.completed'
      : activity.phase === 'cancelled' ? 'compaction.status.cancelled' : 'compaction.status.failed';
  return <div className={`compaction-status compaction-status--${activity.phase}`} role="status" aria-live="polite">
    <span className="compaction-status__mark" aria-hidden="true">{activity.phase === 'running' ? '' : activity.phase === 'completed' ? '✓' : '—'}</span>
    <span>{activity.phase === 'running' && activity.message ? activity.message : t(key)}
      {activity.phase === 'failed' && activity.message ? ` · ${activity.message}` : ''}</span>
  </div>;
}
