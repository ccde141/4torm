import type { ContextMessage } from '../../../engine/shared/types.js';
import type { MonsoonSession, MonsoonTokenUsage } from '../domain/session.js';
import type { CompactionCommit, CompactionReason } from '../../../engine/shared/compaction/index.js';

/** A caller holds the session lease from context loading through the final append. */
export interface MonsoonExternalSessionPort {
  acquire(agentId: string, sessionId: string): (() => void) | null;
  read(agentId: string, sessionId: string): Promise<MonsoonSession | null>;
  activeContext(session: MonsoonSession): Promise<ContextMessage[]>;
  list(agentId: string): Promise<MonsoonSessionSummary[]>;
  append(agentId: string, sessionId: string, expectedRevision: number,
    user: MonsoonExternalMessage, assistant: MonsoonExternalMessage,
    activeContext?: ContextMessage[]): Promise<void>;
  recordUsage(agentId: string, sessionId: string, expectedRevision: number,
    usage: MonsoonTokenUsage | null): Promise<MonsoonSession>;
  archive(agentId: string, sessionId: string, context: ContextMessage[], reason: CompactionReason): Promise<void>;
  commitCompaction(agentId: string, sessionId: string, expectedRevision: number,
    plan: CompactionCommit, signal?: AbortSignal): Promise<MonsoonSession>;
}

export interface MonsoonExternalMessage {
  id: string;
  content: string;
  timestamp?: string;
  nativeContext?: ContextMessage[];
  contextExact?: boolean;
  contextOmitted?: boolean;
}

export interface MonsoonSessionSummary {
  id: string;
  agentId: string;
  title: string;
  updatedAt: string;
  revision: number;
}
