import type { WorkspaceEntityStatus } from '../pages/cyclone-workspace-status.js';
import { relationPair } from './organization-runtime.js';

export interface ExternalActivityResponse {
  runningSeatIds: string[];
  activities: Record<string, {
    id: string;
    kind: 'contact' | 'dispatch' | 'join-summary';
    sourceSeatId?: string;
  }>;
}

export interface ExternalActivityProjection {
  runningSeatIds: ReadonlySet<string>;
  activeContactPairs: ReadonlySet<string>;
  activeDispatchPairs: ReadonlySet<string>;
}

export function projectExternalActivity(payload: ExternalActivityResponse): ExternalActivityProjection {
  const activeContactPairs = new Set<string>();
  const activeDispatchPairs = new Set<string>();
  for (const [targetSeatId, activity] of Object.entries(payload.activities)) {
    if (!activity.sourceSeatId) continue;
    const pair = relationPair(activity.sourceSeatId, targetSeatId);
    if (activity.kind === 'contact') activeContactPairs.add(pair);
    if (activity.kind === 'dispatch') activeDispatchPairs.add(pair);
  }
  return { runningSeatIds: new Set(payload.runningSeatIds), activeContactPairs, activeDispatchPairs };
}

export function mergeActivityPairs(
  local: Set<string>, external: ReadonlySet<string>,
): Set<string> {
  return external.size === 0 ? local : new Set([...local, ...external]);
}

export function mergeExternalRunningSeatStatuses(
  statuses: Map<string, WorkspaceEntityStatus>,
  runningSeatIds: ReadonlySet<string>,
): Map<string, WorkspaceEntityStatus> {
  if (runningSeatIds.size === 0) return statuses;
  const merged = new Map(statuses);
  runningSeatIds.forEach(seatId => merged.set(seatId, 'running'));
  return merged;
}
