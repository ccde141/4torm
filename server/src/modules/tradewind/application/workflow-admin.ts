import type { AutoProfile } from '../../../engine/tradewind/foundation/types/index.js';
import type { SaveWorkflowDefinition, WorkflowDefinition, WorkflowSummary } from './workflow-store.js';

export interface SaveWorkflowCommand extends SaveWorkflowDefinition {}

export interface TradewindWorkflowAdmin {
  load(workflowId: string): Promise<WorkflowDefinition>;
  list(): Promise<WorkflowSummary[]>;
  save(input: SaveWorkflowCommand): Promise<{ saved: true; workflowId: string; name: string; revision: string }>;
  delete(workflowId: string, expectedRevision: string): Promise<{ deleted: true; workflowId: string }>;
  openWorkspace(workflowId: string): Promise<{ opened: true; workflowId: string; path: string }>;
  loadProfiles(workflowId: string): Promise<AutoProfile[]>;
  saveProfiles(workflowId: string, profiles: AutoProfile[]): Promise<{ saved: true; count: number }>;
  deleteProfile(workflowId: string, profileId: string): Promise<{ deleted: true; profileId: string }>;
}
