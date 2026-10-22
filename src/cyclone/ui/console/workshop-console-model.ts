import type { WorkspaceEntityStatus } from '../pages/cyclone-workspace-status';

export interface ConsoleEvent {
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

export interface SeatCollaboration {
  contact: boolean;
  dispatch: boolean;
  bulletin: boolean;
}

export interface ConsoleSeat {
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
  error?: string;
  recent: ConsoleEvent[];
  capabilities: {
    available: boolean;
    agentName: string;
    model: string;
    tools: Array<{ name: string; description: string }>;
    skills: Array<{ id: string; name: string; description: string }>;
  };
  collaboration: SeatCollaboration;
}

export interface WorkshopConsoleSnapshot {
  workshopId: string;
  title: string;
  workspacePath: string;
  capturedAt: string;
  seats: ConsoleSeat[];
  recent: ConsoleEvent[];
  stats: { seatCount: number; executionCount: number; dispatchCount: number; memoryCount: number | null };
}

export interface SeatMemoryEntry { id: string; title: string; content: string; updatedAt: string }
export interface SeatMemoryDocument { revision: number; entries: SeatMemoryEntry[] }

export type ConsoleSection = 'overview' | 'recent' | 'stats' | 'config' | 'memory' | 'inherited' | 'collaboration';
export type ConsoleFilter = 'all' | WorkspaceEntityStatus;
export type SeatHistoryFilter = 'all' | 'work' | 'changes';
export interface SeatHistoryPage {
  items: ConsoleEvent[];
  total: number;
  nextCursor?: string;
  revision: string;
  capturedAt: string;
}

export function consoleEventSection(event: ConsoleEvent): ConsoleSection | null {
  if (event.kind === 'memory') return 'memory';
  if (event.kind === 'configuration' && event.changedFields?.length
    && event.changedFields.every(field => field === 'collaboration' || field.startsWith('collaboration.'))) {
    return 'collaboration';
  }
  if (event.kind === 'configuration' || event.kind === 'binding') return 'config';
  return null;
}

export function filterConsoleSeats(seats: ConsoleSeat[], statuses: ReadonlyMap<string, WorkspaceEntityStatus>,
  filter: ConsoleFilter, search: string): ConsoleSeat[] {
  const query = search.trim().toLocaleLowerCase();
  return seats.filter(seat => (filter === 'all' || (statuses.get(seat.id) ?? 'unknown') === filter)
    && `${seat.title} ${seat.duty ?? ''} ${seat.capabilities.agentName}`.toLocaleLowerCase().includes(query));
}

export function eventDisplayStatus(status: string): WorkspaceEntityStatus | 'completed' | 'aborted' {
  if (status === 'queued' || status === 'running') return 'running';
  if (status === 'waiting' || status === 'awaiting_human') return 'waiting';
  if (status === 'failed' || status === 'crashed') return 'failed';
  if (status === 'completed' || status === 'aborted') return status;
  return 'unknown';
}
