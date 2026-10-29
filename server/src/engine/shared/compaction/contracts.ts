import type { ContextMessage } from '../types.js';
import type { LLMCaller } from '../react/native-loop.js';
import type { ToolDef } from '../tool-defs-loader.js';

export const COMPACTION_AREAS = [
  'monsoon', 'convection', 'cycloneConversation', 'cycloneMeeting',
  'tradewindConversation', 'tradewindMeeting', 'tide',
] as const;
export type CompactionArea = typeof COMPACTION_AREAS[number];
export type CompactionReason = 'threshold' | 'provider-overflow' | 'manual';
export type CompactionMode = 'partial' | 'full';

export interface CompactionProgress {
  type: 'compact-start' | 'compact-done' | 'compact-failed';
  id: string;
  operation: 'compact' | 'reset';
  startedAt: number;
  updatedAt: number;
  reason: CompactionReason;
  message?: string;
  aborted?: boolean;
  summaryLength?: number;
  /** Present only after a successful durable compaction, for display boundaries. */
  summary?: string;
  archivedMessages?: number;
}

export interface CompactionPolicy {
  version: 1;
  enabled: boolean;
  prefixRatio: number;
  modelMode: 'current' | 'fixed';
  fixedModel: string | null;
  thresholds: Record<CompactionArea, number>;
}

export interface CompactionNotice {
  type: 'compaction-notice';
  severity: 'error';
  model: string;
  fallbackModel?: string;
  message: string;
  reason: CompactionReason;
}

export interface CompactionCommit {
  reason: CompactionReason;
  mode: CompactionMode;
  before: ContextMessage[];
  prefix: ContextMessage[];
  tail: ContextMessage[];
  summary: string;
  messages: ContextMessage[];
  sourceTokens: number;
}
export type CompactionPlan = CompactionCommit;

/** Original request framing, supplied by the owning feature without changing stored history. */
export interface CompactionRequestContext {
  messages: ContextMessage[];
  tools?: ToolDef[];
  historyToolTransport?: 'native' | 'text';
}

export interface CompactionSummaryInput {
  model: string;
  prompt: string;
  /** Ordered original framing and selected history; the summary instruction is appended last. */
  messages: ContextMessage[];
  tools?: ToolDef[];
  historyToolTransport?: 'native' | 'text';
  /** Text projection for validation and diagnostics, never a replacement for ordered messages. */
  text: string;
  /** Final summary text only; reasoning is never charged against this allowance. */
  maxContentTokens: number;
  /** Provider completion allowance, including separate headroom for thinking when needed. */
  maxOutputTokens: number;
  /** First-phase thinking allowance; the final body phase is bounded by maxOutputTokens. */
  maxReasoningTokens?: number;
  /** Preserve limit completion through island adapters; it is not a provider failure. */
  onOutputLimited?: () => void;
  /** Publishes the accepted complete summary; partial provider output is never published. */
  onChunk?: (text: string) => void;
  signal?: AbortSignal;
}

/** Islands own archives and revision/lease checks; the controller never opens their stores. */
export interface CompactionOptions {
  dataDir: string;
  area: CompactionArea;
  model: string;
  kind: 'conversation' | 'meeting';
  chairModel?: string;
  prompt?: string;
  summaryContext?: CompactionRequestContext;
  scopeKey?: string;
  initialPromptTokens?: number;
  /** Estimate of the request associated with initialPromptTokens, before new human input is appended. */
  initialEstimateTokens?: number;
  protectedPrefixCount?: number;
  /** Complete human-led turns retained verbatim; meetings use three and private sessions four. */
  recentHumanTurns?: 3 | 4;
  /** Available space for the handoff after protected prompts and recent complete turns. */
  summaryTokenBudget?: number;
  /** Tool schemas and other request framing outside the history array. */
  requestOverheadTokens?: number;
  boundaries?: (messages: readonly ContextMessage[]) => readonly number[];
  archive?: (before: ContextMessage[], reason: CompactionReason) => Promise<void>;
  commit?: (plan: CompactionCommit, signal?: AbortSignal) => Promise<void>;
  onNotice?: (notice: CompactionNotice) => void | Promise<void>;
  /** Observation only: progress delivery cannot undo a successful durable commit. */
  onProgress?: (event: CompactionProgress) => void | Promise<void>;
  onCompacted?: (plan: CompactionCommit) => void | Promise<void>;
  onSummaryChunk?: (text: string) => void;
  summarize?: (input: CompactionSummaryInput) => Promise<string>;
  resolveSummaryBudget?: (model: string) => Promise<number | undefined>;
}

export interface CompactionCallerOptions extends CompactionOptions { llm: LLMCaller }
export interface CompactMessagesOptions extends CompactionOptions {
  messages: ContextMessage[];
  mode: CompactionMode;
  reason: CompactionReason;
  signal?: AbortSignal;
  policy?: CompactionPolicy;
}
