import { invokeFeature } from '../../../../api/collaboration';
import type { WorkflowGraph } from '../../../types';

export interface WorkflowRunSummary {
  workflowId: string;
  executionId: string;
  status: 'running' | 'completed' | 'failed' | 'aborted' | 'crashed';
  startTime: string;
  endTime?: string;
  errorCode?: string;
  errorMessage?: string;
}
export interface WorkflowRunArchive {
  kind: 'output' | 'node-context' | 'meeting';
  nodeId?: string;
  round?: number;
  state: 'available' | 'missing';
  sizeBytes?: number;
}
export interface WorkflowRun extends WorkflowRunSummary { graph: WorkflowGraph; archives?: WorkflowRunArchive[] }
export interface WorkflowRunsPage { items: WorkflowRunSummary[]; nextCursor?: string }
export interface WorkflowRunEvent {
  eventOffset: number;
  timestamp: string;
  nodeId: string;
  eventTypeId: string;
  preview: string;
  hasPayload: boolean;
  source?: string;
  target?: string;
}
export interface RunEventsPage { items: WorkflowRunEvent[]; nextCursor?: string; scannedToEnd: boolean }
export interface RunEventFragment {
  text: string; nextOffset?: number; totalChars: number; presentation?: 'public-conversation';
}
export interface EventsQuery {
  workflowId: string;
  executionId: string;
  cursor?: string;
  eventType?: string;
  since?: string;
  until?: string;
}

export function listWorkflowRuns(workflowId: string, cursor?: string): Promise<WorkflowRunsPage> {
  return invokeFeature('tradewind', 'listWorkflowRuns', { workflowId, limit: 20, ...(cursor ? { cursor } : {}) });
}
export function readWorkflowRun(workflowId: string, executionId: string): Promise<WorkflowRun> {
  return invokeFeature('tradewind', 'readWorkflowRun', { workflowId, executionId });
}
export function readWorkflowRunEvents(input: EventsQuery): Promise<RunEventsPage> {
  return invokeFeature('tradewind', 'readWorkflowRunEvents', { ...input, limit: 30 });
}
export function readWorkflowRunEvent(
  workflowId: string, executionId: string, eventOffset: number, offset = 0,
): Promise<RunEventFragment> {
  return invokeFeature('tradewind', 'readWorkflowRunEvent', {
    workflowId, executionId, eventOffset, offset, maxChars: 16_384,
  });
}

export function readWorkflowRunArchive(workflowId: string, executionId: string,
  archive: Pick<WorkflowRunArchive, 'kind' | 'nodeId' | 'round'>, offset = 0,
): Promise<RunEventFragment> {
  return invokeFeature('tradewind', 'readWorkflowRunArchive', {
    workflowId, executionId, kind: archive.kind, ...(archive.nodeId === undefined ? {} : { nodeId: archive.nodeId }),
    ...(archive.round === undefined ? {} : { round: archive.round }), offset, maxChars: 16_384,
  });
}
