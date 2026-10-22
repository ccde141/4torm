import type { WorkflowNode } from '../../types';
import type { ExecutionPhase } from '../hooks/execution-phase';
import type { WorkflowNodeStatus } from '../hooks/useWorkflowNodeStatus';

export interface RuntimeNodeIdentity { workflowId: string; executionId: string }
export interface RuntimeNodeAction {
  eventName: 'tw-open-chat' | 'tw-open-meeting' | 'tw-open-gate';
  detail: RuntimeNodeIdentity & { nodeId: string; label: string; envelopeContent?: string };
}

/** A completed run remains readable; only review actions require an active run. */
export function runtimeNodeAction(node: WorkflowNode, identity: RuntimeNodeIdentity,
  live: boolean, status?: WorkflowNodeStatus,
): RuntimeNodeAction | undefined {
  if (!identity.workflowId || !identity.executionId) return;
  const detail = { ...identity, nodeId: node.id, label: node.label };
  if (node.type === 'agent') return { eventName: 'tw-open-chat', detail };
  if (node.type === 'meeting') return { eventName: 'tw-open-meeting', detail };
  if (node.type === 'human-gate' && live && status?.humanGate?.waiting) {
    return { eventName: 'tw-open-gate', detail: { ...detail, envelopeContent: status.humanGate.envelopeContent } };
  }
}

export function completionFeedbackRemaining(status: WorkflowNodeStatus | undefined, now: number): number {
  if (status?.terminalOutcome !== 'completed' || !Number.isFinite(status.completedAt)) return 0;
  return Math.min(15_000, Math.max(0, status.completedAt! + 15_000 - now));
}

export function runtimeNodeClasses(nodeType: string, selected: boolean, status: WorkflowNodeStatus | undefined,
  showCompletion: boolean, phase?: ExecutionPhase,
): string {
  const terminal = !status?.busy && status?.terminalOutcome;
  return ['tw-node', `tw-node--${nodeType === 'human-gate' ? 'gate' : nodeType}`,
    selected && 'tw-node--selected', status?.busy && 'tw-node--busy',
    status?.envelopePending && 'tw-node--envelope',
    status?.humanGate?.waiting && 'tw-node--gate-waiting',
    terminal === 'completed' && showCompletion && 'tw-node--just-done',
    terminal === 'stopped' && 'tw-node--stopped', terminal === 'error' && 'tw-node--failed',
    nodeType === 'output' && phase === 'completed' && 'tw-node--output-complete',
    nodeType === 'output' && ['stopped', 'failed', 'interrupted'].includes(phase ?? '') && 'tw-node--output-missed',
  ].filter(Boolean).join(' ');
}
