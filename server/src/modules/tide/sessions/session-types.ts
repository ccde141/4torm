import type { TokenUsage } from '../../../engine/shared/llm-bridge.js';
import type { TideUsageProgress } from '../domain/token-usage.js';
import type { ContextMessage } from '../../../engine/shared/types.js';
import type { CompactionProgress } from '../../../engine/shared/compaction/index.js';

export interface TideMessage {
  id: string;
  role: string;
  origin?: ContextMessage['origin'];
  content: string;
  timestamp?: string;
  type?: 'compact-marker';
  nativeContext?: ContextMessage[];
  contextExact?: boolean;
  contextOmitted?: boolean;
  compactionId?: string;
  /** A model-context checkpoint after a turn, without a new compaction boundary. */
  contextOnly?: boolean;
  toolImages?: ContextMessage['toolImages'];
}

export interface TideSession {
  id: string;
  agentId: string;
  agentName: string;
  title: string;
  messages: TideMessage[];
  model: string;
  systemPrompt: string;
  createdAt: string;
  updatedAt: string;
  revision?: number;
  messageRevision?: number;
  tokenUsage?: TokenUsage;
  usage?: TideUsageProgress;
  compaction?: CompactionProgress;
}

export interface ArchiveResult {
  archived: boolean;
  newRoundSeq: number;
  newBatch: number;
}
