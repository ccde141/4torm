import { useState } from 'react';
import { acknowledgeWorkflowRun, readAcknowledgedWorkflowRuns, WORKFLOW_READ_RUNS_KEY } from './workflow-card-state';
import type { WorkflowSidebarItem } from './workspace-types';

function storage(): Storage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage; }
  catch { return undefined; }
}

export function useWorkflowCardReadState() {
  const [acknowledged, setAcknowledged] = useState(() => readAcknowledgedWorkflowRuns(storage()));
  const acknowledge = (item: WorkflowSidebarItem) => {
    const next = acknowledgeWorkflowRun(acknowledged, item);
    if (next === acknowledged) return;
    setAcknowledged(next);
    try { storage()?.setItem(WORKFLOW_READ_RUNS_KEY, JSON.stringify(next)); }
    catch { /* Keep the confirmation for this view when browser storage is unavailable. */ }
  };
  return { acknowledged, acknowledge };
}
