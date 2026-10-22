import { useCallback, useEffect, useRef, useState } from 'react';
import { listWorkflows, type WorkflowSummary } from '../workflow-client';
import { WorkflowLoadGate } from '../hooks/workflow-load-gate';

/** Always mounted: human and Agent saves already notify the same page refresh key. */
export function useWorkflowCatalog(refreshKey: number) {
  const [items, setItems] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const gate = useRef(new WorkflowLoadGate());
  const refresh = useCallback(async () => {
    const request = gate.current.next();
    setLoading(true);
    try {
      const data = await listWorkflows();
      if (!gate.current.isCurrent(request)) return;
      setItems(data);
      setError(null);
    } catch (cause) {
      if (gate.current.isCurrent(request)) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (gate.current.isCurrent(request)) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const currentGate = gate.current;
    void refresh();
    return () => currentGate.invalidate();
  }, [refresh, refreshKey]);
  return { items, loading, error, refresh };
}
