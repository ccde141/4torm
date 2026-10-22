import { belongsToExecution, type ExecutionIdentity } from './execution-visibility';

export interface WorkflowNodeStatus {
  busy: boolean;
  envelopePending: boolean;
  humanGate?: { waiting: true; envelopeContent: string; arrivedAt: number };
  terminalOutcome?: 'completed' | 'stopped' | 'error';
  completedAt?: number;
}

export interface WorkflowNodeStatusSnapshot {
  workflowId?: string | null;
  executionId?: string | null;
  running: boolean;
  nodes?: Record<string, WorkflowNodeStatus>;
}

export interface WorkflowNodeFeedbackEvent {
  workflowId?: string;
  executionId?: string;
  nodeId?: string;
  scope?: string;
  type?: string;
  busy?: boolean;
  outcome?: string;
}

/** Polling owns activity; only explicit node events can confirm a terminal result. */
export function mergeWorkflowNodeStatuses(
  current: Record<string, WorkflowNodeStatus>, snapshot: WorkflowNodeStatusSnapshot,
  identity: ExecutionIdentity, changedSinceRequest: ReadonlySet<string> = new Set(),
): Record<string, WorkflowNodeStatus> {
  if (!belongsToExecution(snapshot, identity)) return current;
  const incoming = snapshot.running ? snapshot.nodes ?? {} : {};
  const result: Record<string, WorkflowNodeStatus> = {};
  for (const id of new Set([...Object.keys(current), ...Object.keys(incoming)])) {
    const previous = current[id];
    if (changedSinceRequest.has(id) && previous) { result[id] = previous; continue; }
    const value = incoming[id];
    const active = value ? activity(value) : { busy: false, envelopePending: false };
    const terminal = active.busy ? undefined : previous?.terminalOutcome;
    result[id] = { ...active, ...(terminal ? { terminalOutcome: terminal,
      ...(terminal === 'completed' && previous.completedAt !== undefined ? { completedAt: previous.completedAt } : {}),
    } : {}) };
  }
  return result;
}

export function applyWorkflowNodeFeedback(
  current: Record<string, WorkflowNodeStatus>, event: WorkflowNodeFeedbackEvent,
  identity: ExecutionIdentity, now: number,
): Record<string, WorkflowNodeStatus> {
  if (!belongsToExecution(event, identity) || !event.nodeId
    || (event.scope && event.scope !== 'agent' && event.scope !== 'meeting')) return current;
  const previous = current[event.nodeId];
  const base = activity(previous);
  if (event.type === 'round-start' || (event.type === 'connected' && event.busy === true)) {
    return { ...current, [event.nodeId]: { ...base, busy: true } };
  }
  const outcome = event.type === 'error' ? 'error' : event.type === 'done' ? event.outcome : undefined;
  if (outcome !== 'completed' && outcome !== 'stopped' && outcome !== 'error') return current;
  if (previous?.terminalOutcome === outcome && !previous.busy) return current;
  return { ...current, [event.nodeId]: { ...base, busy: false, terminalOutcome: outcome,
    ...(outcome === 'completed' ? { completedAt: now } : {}),
  } };
}

function activity(value?: WorkflowNodeStatus): WorkflowNodeStatus {
  return { busy: Boolean(value?.busy), envelopePending: Boolean(value?.envelopePending),
    ...(value?.humanGate ? { humanGate: value.humanGate } : {}) };
}
