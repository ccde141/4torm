import { backendFetch } from '../../../lib/backend-client';
import { useEffect, useState } from 'react';
import {
  projectExternalActivity,
  type ExternalActivityProjection,
  type ExternalActivityResponse,
} from './organization-external-status';

function emptyProjection(): ExternalActivityProjection {
  return { runningSeatIds: new Set(), activeContactPairs: new Set(), activeDispatchPairs: new Set() };
}

function sameIds(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every(id => right.has(id));
}

function sameProjection(left: ExternalActivityProjection, right: ExternalActivityProjection): boolean {
  return sameIds(left.runningSeatIds, right.runningSeatIds)
    && sameIds(left.activeContactPairs, right.activeContactPairs)
    && sameIds(left.activeDispatchPairs, right.activeDispatchPairs);
}

export function useOrganizationExternalActivity(
  workshopId: string,
  enabled: boolean,
): ExternalActivityProjection {
  const [activity, setActivity] = useState<ExternalActivityProjection>(emptyProjection);

  useEffect(() => {
    setActivity(emptyProjection());
    if (!enabled) return;
    let stopped = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;

    const poll = async () => {
      controller = new AbortController();
      let hasRunning = false;
      try {
        const response = await backendFetch(
          `/api/cyclone/workshop/${encodeURIComponent(workshopId)}/activities`,
          { signal: controller.signal },
        );
        if (!response.ok || stopped) return;
        const payload = await response.json() as ExternalActivityResponse;
        const next = projectExternalActivity(payload);
        hasRunning = next.runningSeatIds.size > 0;
        setActivity(current => sameProjection(current, next) ? current : next);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') console.error('[cyclone] 读取工作室活动失败', error);
      } finally {
        if (!stopped) timer = window.setTimeout(poll, hasRunning ? 350 : 1_000);
      }
    };

    void poll();
    return () => {
      stopped = true;
      controller?.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled, workshopId]);

  return activity;
}
