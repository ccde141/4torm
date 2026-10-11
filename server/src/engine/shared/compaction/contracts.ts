import type { ContextMessage } from '../types.js';
import type { LLMCaller } from '../react/native-loop.js';

export const COMPACTION_AREAS = [
  'monsoon', 'convection', 'cycloneConversation', 'cycloneMeeting',
  'tradewindConversation', 'tradewindMeeting', 'tide',
] as const;
export type CompactionArea = typeof COMPACTION_AREAS[number];
export type CompactionReason = 'threshold' | 'provider-overflow' | 'manual';
export type CompactionMode = 'partial' | 'full';

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

export interface CompactionSummaryInput {
  model: string;
  prompt: string;
  text: string;
  /** Final summary text only; reasoning is never charged against this allowance. */
  maxContentTokens: number;
  /** Provider completion allowance, including separate headroom for thinking when needed. */
  maxOutputTokens: number;
  /** First-phase thinking allowance; the final body phase is bounded by maxOutputTokens. */
  maxReasoningTokens?: number;
  /** Preserve limit completion through island adapters; it is not a provider failure. */
  onOutputLimited?: () => void;
  /** Present only for the selected final stage, never for intermediate working fragments. */
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
  scopeKey?: string;
  initialPromptTokens?: number;
  /** Estimate of the request associated with initialPromptTokens, before new human input is appended. */
  initialEstimateTokens?: number;
  protectedPrefixCount?: number;
  boundaries?: (messages: readonly ContextMessage[]) => readonly number[];
  archive?: (before: ContextMessage[], reason: CompactionReason) => Promise<void>;
  commit?: (plan: CompactionCommit) => Promise<void>;
  onNotice?: (notice: CompactionNotice) => void | Promise<void>;
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
