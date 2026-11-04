export interface RecallScope { agentId: string; sessionId: string }
export interface RecallRecord {
  id: string; kind: 'memory' | 'work'; title: string; summary: string; revision: string;
  agentId: string; sessionId?: string; sessionTitle?: string; sourceId?: string;
  timestamp: string; date?: string; sequence?: number; timezone?: string; scope?: string;
  sourceRevision?: string; category?: string; archived?: boolean;
}
export interface RecallRecentMessage { role: 'user' | 'assistant'; content: string }
export interface RecallCandidateRecord extends RecallRecord { excerpt?: string; excerptOffset?: number; score?: number }
export interface RecallDocument extends RecallRecord { content: string; updated?: string; slug?: string }
/** Features supply their own archival bridge; the shared kernel never opens feature stores. */
export interface RecallSources {
  sync(agentId: string, signal?: AbortSignal): Promise<void>;
  list(agentId: string): Promise<RecallRecord[]>;
  read(agentId: string, id: string): Promise<RecallDocument | null>;
  readOriginal?(agentId: string, id: string, offset: number, limit: number): Promise<{ content: string; total: number } | null>;
  sessionVersion?(agentId: string, sessionId: string): Promise<string | null>;
}
export interface RecallCard {
  id: string; revision: string; level: 'L1' | 'L2'; text: string; title: string; kind: RecallRecord['kind'];
  sessionId?: string; date?: string; sequence?: number;
  scope?: string; timestamp?: string; sourceId?: string;
  sourceRevision?: string;
  /** Why the selected historical passage applies; never an instruction to resume its old task. */
  relevance?: string;
}
export interface RecallPending extends RecallCard {
  preparedFor: string; preparedAt: string; context: RecallRecentMessage[];
  status: 'ready' | 'shelved' | 'staged' | 'applied'; deliveryId?: string;
}
export interface RecallDelivery {
  id: string; inputKey: string; status: 'staged' | 'applied' | 'invalidated'; timestamp: string;
  sources: Array<{ id: string; revision: string }>;
}
export interface RecallSessionState {
  reflection?: { query: string; candidates: string[]; compact: string; vector?: number[]; accepted?: string[] };
  pendingReflection?: RecallSessionState['reflection'];
  selection?: { reason: 'injected' | 'already-present' | 'no-match' | 'filtered' | 'failed' | 'prepared';
    candidateCount: number; selectedCount: number; attachedCount: number; duplicateCount: number; unavailableCount: number };
  version: 1 | 2; inputKey: string; query: string; configuration?: string;
  status: 'idle' | 'queued' | 'searching' | 'ready' | 'empty' | 'cancelled' | 'failed';
  updatedAt: string; cards: RecallCard[]; error?: string;
  usage?: import('../model-request-usage.js').ModelUsageProgress;
  owner?: RecallScope; sourceVersion?: string; recentConversation?: RecallRecentMessage[]; currentMessage?: string;
  pending?: RecallPending[]; deliveries?: RecallDelivery[]; candidates?: RecallCandidateRecord[];
}
