import type { CompactionProgress } from '../../shared/compaction/index.js';
import type { MeetingSessionData } from './meeting-session.js';
import { broadcastToMeeting } from '../streaming/meeting-broadcast.js';

export type MeetingCompactionTarget = 'public' | 'chair';
const waiters = new WeakMap<MeetingSessionData, Set<() => void>>();

/** Keep the latest fact with its owner so late subscribers recover the same activity. */
export function publishMeetingCompaction(
  session: MeetingSessionData, target: MeetingCompactionTarget, event: CompactionProgress & { label?: string },
): void {
  session.compactions = { ...session.compactions, [target]: event };
  try { broadcastToMeeting(session.nodeId, { ...event, target }, session.executionId); }
  finally {
    if (!hasRunningCompaction(session)) {
      for (const resolve of waiters.get(session) ?? []) resolve();
      waiters.delete(session);
    }
  }
}

/** A stopped meeting keeps its transport identity until an in-flight commit has a real outcome. */
export function waitForMeetingCompactions(session: MeetingSessionData): Promise<void> {
  if (!hasRunningCompaction(session)) return Promise.resolve();
  return new Promise(resolve => {
    const pending = waiters.get(session) ?? new Set();
    pending.add(resolve);
    waiters.set(session, pending);
  });
}

function hasRunningCompaction(session: MeetingSessionData): boolean {
  return Object.values(session.compactions ?? {}).some(event => event.type === 'compact-start');
}

export function finishMeetingCompactions(
  session: MeetingSessionData, aborted: boolean, message: string, target?: MeetingCompactionTarget,
): void {
  for (const scope of target ? [target] : ['public', 'chair'] as const) {
    const current = session.compactions?.[scope];
    if (current?.type !== 'compact-start') continue;
    publishMeetingCompaction(session, scope, { ...current, type: 'compact-failed',
      updatedAt: Date.now(), message, ...(aborted ? { aborted: true } : {}) });
  }
}
