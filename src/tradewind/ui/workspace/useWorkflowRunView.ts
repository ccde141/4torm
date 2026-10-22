import { useEffect, useState } from 'react';
import { readWorkflowRun, type WorkflowRun } from './records/records-client';

export function useWorkflowRunView(workflowId: string, activeExecutionId: string | null, phase: string) {
  const [history, setHistory] = useState<Record<string, WorkflowRun>>({});
  const [accepted, setAccepted] = useState<Record<string, WorkflowRun>>({});
  const [refreshes, setRefreshes] = useState<Record<string, number>>({});
  const refresh = refreshes[workflowId] ?? 0;
  const selected = history[workflowId];
  const executionId = selected?.executionId ?? activeExecutionId;
  const identity = `${workflowId}:${executionId ?? ''}`;
  const [snapshot, setSnapshot] = useState<{ identity: string; run?: WorkflowRun; error?: string }>({ identity: '' });
  useEffect(() => {
    let cancelled = false;
    if (!executionId) return;
    void readWorkflowRun(workflowId, executionId).then(run => {
      if (!cancelled) setSnapshot({ identity, run });
    }).catch(cause => {
      if (!cancelled) setSnapshot(previous => ({ identity,
        ...(previous.identity === identity ? { run: previous.run } : {}),
        error: cause instanceof Error ? cause.message : String(cause) }));
    });
    return () => { cancelled = true; };
  }, [identity, executionId, workflowId, phase, refresh]);
  const preview = accepted[workflowId]?.executionId === executionId ? accepted[workflowId] : undefined;
  const run = (snapshot.identity === identity ? snapshot.run : undefined) ?? selected ?? preview;
  const error = snapshot.identity === identity ? snapshot.error : undefined;
  return { executionId, run, error, loading: Boolean(executionId && !run && !error),
    started: (value: WorkflowRun) => {
      setAccepted(previous => ({ ...previous, [value.workflowId]: value }));
      setHistory(previous => { const next = { ...previous }; delete next[value.workflowId]; return next; });
    },
    select: (value: WorkflowRun) => setHistory(previous => ({ ...previous, [value.workflowId]: value })),
    latest: (targetWorkflowId = workflowId) => {
      setHistory(previous => { const next = { ...previous }; delete next[targetWorkflowId]; return next; });
      setRefreshes(previous => ({ ...previous, [targetWorkflowId]: (previous[targetWorkflowId] ?? 0) + 1 }));
    },
  };
}
