import type { TokenUsage } from '../../../engine/shared/llm-bridge.js';
import type { TideUsageProgress } from '../domain/token-usage.js';
import type { ContextMessage } from '../../../engine/shared/types.js';

export interface TideMessage {
  id: string;
  role: string;
  content: string;
  timestamp?: string;
  type?: 'compact-marker';
  nativeContext?: ContextMessage[];
  contextExact?: boolean;
  contextOmitted?: boolean;
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
}

export interface ArchiveResult {
  archived: boolean;
  newRoundSeq: number;
  newBatch: number;
}
