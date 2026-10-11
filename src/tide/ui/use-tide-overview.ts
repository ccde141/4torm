import { useCallback, useEffect, useRef, useState } from 'react';
import { listTasks, type TideTask } from '../../api/tide';
import {
  observeAllFeature,
  type CollaborationProbeItem,
} from '../../api/collaboration';
import { createLatestRequestGuard } from '../../lib/latest-request';
import { visibleTideOverview, type ScopedTideOverview } from './tide-overview-scope';

export function useTideOverview(selectedAgentId: string | undefined, active: boolean) {
  const [snapshot, setSnapshot] = useState<ScopedTideOverview<TideTask, CollaborationProbeItem>>({
    agentId: null, tasks: [], probes: [],
  });
  const [failure, setFailure] = useState<{ agentId: string | null; message: string }>();
  const guard = useRef(createLatestRequestGuard());

  const refresh = useCallback(async () => {
    const request = guard.current.begin();
    try {
      const [allTasks, observedItems] = await Promise.all([
        listTasks(),
        observeAllFeature('tide', { view: 'summary', limit: 200 }),
      ]);
      if (!request.isCurrent()) return;
      setSnapshot({ agentId: selectedAgentId ?? null,
        tasks: selectedAgentId ? allTasks.filter(task => task.agentId === selectedAgentId) : allTasks,
        probes: observedItems });
      setFailure(undefined);
    } catch (cause) {
      if (request.isCurrent()) setFailure({ agentId: selectedAgentId ?? null,
        message: cause instanceof Error ? cause.message : String(cause) });
    }
  }, [selectedAgentId]);

  useEffect(() => {
    void refresh();
    if (!active) return () => guard.current.cancel();
    const timer = setInterval(() => void refresh(), 3000);
    return () => { clearInterval(timer); guard.current.cancel(); };
  }, [active, refresh]);

  const scoped = visibleTideOverview(snapshot, selectedAgentId ?? null);
  return { ...scoped, error: failure?.agentId === (selectedAgentId ?? null)
    ? failure.message : undefined, refresh };
}
