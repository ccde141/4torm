import { isCompactionHistory } from '../../components/common/compaction-history';

export interface CompactionEvent {
  type: 'compact-start' | 'compact-done' | 'compact-failed';
  id: string;
  operation: 'compact' | 'reset';
  startedAt: number;
  updatedAt: number;
  reason: 'manual' | 'threshold' | 'provider-overflow';
  message?: string;
  summary?: string;
  label?: string;
  aborted?: boolean;
  target?: 'public' | 'chair';
}

export function historyCommand(text: string): 'compact' | 'reset' | undefined {
  return text === '/compact' ? 'compact' : text === '/reset' ? 'reset' : undefined;
}

export function isCompactedHistory(content: string): boolean {
  return isCompactionHistory(content);
}

export function pendingCompaction(operation: 'compact' | 'reset'): CompactionEvent {
  const now = Date.now();
  return { type: 'compact-start', id: `pending-${now}`, operation,
    startedAt: now, updatedAt: now, reason: 'manual' };
}
