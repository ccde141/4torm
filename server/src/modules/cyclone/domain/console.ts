import type { CycloneSupervisorSummary } from './supervisor-view.js';
/** Workshop-scoped read model. Pool capability metadata remains read-only. */
export interface CycloneConsoleEvent {
  id: string;
  seatId: string;
  seatTitle: string;
  kind: 'execution' | 'dispatch' | 'contact' | 'room' | 'configuration' | 'binding' | 'memory';
  title: string;
  status: string;
  startedAt: string;
  updatedAt: string;
  sourceTitle?: string;
  operationId?: string;
  runId?: string;
  roomId?: string;
  dispatchId?: string;
  source?: 'human' | 'seat-agent' | 'supervisor' | 'unknown';
  changedFields?: string[];
  previousAgentId?: string;
  agentId?: string;
  memoryId?: string;
  memoryTitle?: string;
  memoryRevision?: number;
  error?: string;
}

export interface CycloneSeatCollaboration {
  contact: boolean;
  dispatch: boolean;
  bulletin: boolean;
}

export interface CycloneConsoleCapabilities {
  available: boolean;
  agentName: string;
  model: string;
  tools: Array<{ name: string; description: string }>;
  skills: Array<{ id: string; name: string; description: string }>;
}

export interface CycloneConsoleSeat {
  id: string;
  agentId: string;
  title: string;
  duty?: string;
  rolePrompt: string;
  overrideAgentRole: boolean;
  pending: boolean;
  createdAt: string;
  updatedAt: string;
  stats: { executionCount: number; dispatchCount: number; memoryCount: number | null };
  recent: CycloneConsoleEvent[];
  capabilities: CycloneConsoleCapabilities;
  collaboration: CycloneSeatCollaboration;
  error?: string;
}

export interface CycloneWorkshopConsole {
  workshopId: string;
  title: string;
  workspacePath: string;
  capturedAt: string;
  seats: CycloneConsoleSeat[];
  recent: CycloneConsoleEvent[];
  stats: {
    seatCount: number;
    executionCount: number;
    dispatchCount: number;
    memoryCount: number | null;
  };
  supervisor?: CycloneSupervisorSummary;
}

export type CycloneSeatActivityFilter = 'all' | 'work' | 'changes';

export interface CycloneSeatActivityInput {
  workshopId: string;
  seatId: string;
  filter?: CycloneSeatActivityFilter;
  limit?: number;
  cursor?: string;
}

export interface CycloneSeatActivityPage {
  items: CycloneConsoleEvent[];
  total: number;
  nextCursor?: string;
  revision: string;
  capturedAt: string;
}

export type CycloneConsoleSeatFacts = Omit<CycloneConsoleSeat, 'capabilities' | 'recent'>;
