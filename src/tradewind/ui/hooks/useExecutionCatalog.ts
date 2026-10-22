import { useCallback, useEffect, useRef, useState } from 'react';
import { observeAllFeature } from '../../../api/collaboration';
import type { CollaborationProbeItem } from '../../../api/collaboration';
import { subscribeAll, unsubscribeAll } from '../stream/unified-client';

/** SSE requests reconciliation; central probes own the execution facts. */
export function useExecutionCatalog() {
  const [probes, setProbes] = useState<CollaborationProbeItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const pending = useRef<Promise<void> | null>(null);
  const invalidate = useCallback(() => { generation.current++; pending.current = null; }, []);
  const refresh = useCallback(() => {
    if (pending.current) return pending.current;
    const request = generation.current;
    const task = observeAllFeature('tradewind', { view: 'summary', limit: 100 }).then(items => {
      if (request !== generation.current) return;
      setProbes(items); setError(null);
    }).catch(cause => {
      if (request === generation.current) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (pending.current === task) pending.current = null; });
    pending.current = task;
    return task;
  }, []);
  useEffect(() => {
    void refresh();
    const interval = setInterval(() => { if (!document.hidden) void refresh(); }, 1000);
    const visible = () => { if (!document.hidden) void refresh(); };
    const event = (value: { scope?: string; type?: string }) => {
      if (value.scope === 'execution' || value.type === 'transport-reconnected') void refresh();
    };
    subscribeAll(event); document.addEventListener('visibilitychange', visible);
    return () => {
      invalidate(); clearInterval(interval);
      unsubscribeAll(event); document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh, invalidate]);
  return { probes, error, refresh };
}
