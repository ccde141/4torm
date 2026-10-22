import type { WorkflowGraph } from '../../../engine/tradewind/foundation/types/workflow.js';

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
export interface RunIdentity { workflowId: string; executionId: string }
export interface RunListInput { workflowId: string; limit: number; cursor?: string }
export interface RunEventsInput extends RunIdentity {
  limit: number;
  cursor?: string;
  eventType?: string;
  since?: string;
  until?: string;
}
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
export interface RunEventsPage {
  items: WorkflowRunEvent[];
  nextCursor?: string;
  scannedToEnd: boolean;
}
export interface RunEventInput extends RunIdentity {
  eventOffset: number;
  offset: number;
  maxChars: number;
}
export interface RunEventFragment {
  text: string; nextOffset?: number; totalChars: number; presentation?: 'public-conversation'; revision?: string;
}
export interface RunArchiveInput extends RunIdentity {
  kind: WorkflowRunArchive['kind'];
  nodeId?: string;
  round?: number;
  offset: number;
  maxChars: number;
  revision?: string;
}

/** 工作流运行记录；与跨功能区的 operation records 协议分别演进。 */
export interface TradewindHistoryPort {
  list(input: RunListInput): Promise<{ items: WorkflowRunSummary[]; nextCursor?: string;
    preparingExecutionIds?: string[] }>;
  read(input: RunIdentity): Promise<WorkflowRun>;
  events(input: RunEventsInput): Promise<RunEventsPage>;
  event(input: RunEventInput): Promise<RunEventFragment>;
  archive(input: RunArchiveInput): Promise<RunEventFragment>;
}
