import { useCallback, useEffect, useState } from 'react';
import type { WorkflowMode } from '../../types';
import { requestStart, requestStop, type StartWorkflowReceipt } from '../execution-client';
import type { ExecutionPhase } from './execution-phase';
import { useExecutionCatalog } from './useExecutionCatalog';
import { useWorkflowNodeStatus, type WorkflowNodeStatus } from './useWorkflowNodeStatus';
import type { CollaborationProbeItem } from '../../../api/collaboration';
import { selectWorkflowExecution, projectExecutionReceipts } from '../workspace/execution-selection';
import type { HandoffState } from '../../types/handoff';

export interface NodeStatus { busy: boolean; envelopePending: boolean }
export interface ExecutionState {
  running: boolean; executionId: string | null; workflowId: string | null;
  phase: ExecutionPhase; error: string | null; lap: number | null;
  probes: CollaborationProbeItem[];
  nodes: Record<string, WorkflowNodeStatus>;
  handoff?: HandoffState;
}
export interface ExecutionActions {
  start: (workflowId: string, initialInput?: string, mode?: WorkflowMode, profileId?: string) => Promise<StartWorkflowReceipt | null>;
  stop: () => Promise<void>;
}
const phases: Record<CollaborationProbeItem['status'], ExecutionPhase> = {
  idle: 'idle', queued: 'running', running: 'running', waiting: 'running',
  completed: 'completed', aborted: 'stopped', failed: 'failed', crashed: 'interrupted',
};

/** Current controls belong to the selected workflow; the catalog retains other runs. */
export function useExecution(editorWorkflowId: string): ExecutionState & ExecutionActions {
  const { probes, error, refresh } = useExecutionCatalog();
  const [receipts, setReceipts] = useState<Record<string, CollaborationProbeItem>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const fact = probes.find(item => !item.parentOperationId && item.operationId === editorWorkflowId);
  const receipt = receipts[editorWorkflowId];
  const current = selectWorkflowExecution(probes, editorWorkflowId, receipt);
  const running = current !== undefined && ['queued', 'running', 'waiting'].includes(current.status);
  const executionId = current?.runId ?? null;
  const nodeState = useWorkflowNodeStatus(editorWorkflowId, executionId, running);
  useEffect(() => {
    if (!receipt || fact?.runId !== receipt.runId) return;
    setReceipts(previous => { const next = { ...previous }; delete next[editorWorkflowId]; return next; });
  }, [receipt, fact?.runId, editorWorkflowId]);
  useEffect(() => {
    (window as Window & { __tw_running?: boolean }).__tw_running = running;
    return () => { (window as Window & { __tw_running?: boolean }).__tw_running = false; };
  }, [running, editorWorkflowId]);
  const start = useCallback(async (workflowId: string, initialInput?: string, mode: WorkflowMode = 'manual', profileId?: string) => {
    setErrors(previous => ({ ...previous, [workflowId]: null }));
    try {
      const data = await requestStart({ workflowId, initialInput, mode, profileId });
      setReceipts(previous => ({ ...previous, [workflowId]: {
        operationId: workflowId, title: workflowId, runId: data.executionId, status: 'running',
      } }));
      void refresh();
      return data;
    } catch (cause) {
      setErrors(previous => ({ ...previous, [workflowId]: cause instanceof Error ? cause.message : String(cause) }));
      return null;
    }
  }, [refresh]);
  const stop = useCallback(async () => {
    if (!executionId) return;
    try { await requestStop(executionId); await refresh(); }
    catch (cause) { setErrors(previous => ({ ...previous, [editorWorkflowId]: cause instanceof Error ? cause.message : String(cause) })); }
  }, [executionId, editorWorkflowId, refresh]);
  return { running, executionId, workflowId: current?.operationId ?? editorWorkflowId,
    phase: current ? phases[current.status] : 'idle', error: errors[editorWorkflowId] ?? error ?? nodeState.error ?? current?.errorMessage ?? null,
    lap: nodeState.lap, nodes: nodeState.nodes, handoff: nodeState.handoff,
    probes: projectExecutionReceipts(probes, receipts), start, stop };
}
