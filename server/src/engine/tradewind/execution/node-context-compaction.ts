import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteFile } from '../../shared/atomic-io.js';
import { compactMessages, createCompactionCaller, estimateCompactionTokens } from '../../shared/compaction/index.js';
import type { ContextMessage } from '../../shared/types.js';
import type { LLMCaller } from '../../shared/react/native-loop.js';
import type { NodeRunnerEvent } from './node-runner.js';
import { tradewindCompactionGuidance, type NodeCompactionIdentity } from './compaction-guidance.js';

interface NodeCompactionOptions {
  dataDir: string;
  model: string;
  scopeKey: string;
  archiveDir: string;
  messages: ContextMessage[];
  persist: (messages: ContextMessage[]) => Promise<void>;
  emit: (event: NodeRunnerEvent) => void;
  initialPromptTokens?: number;
  initialEstimateTokens?: number;
  prompt?: string;
  identity?: NodeCompactionIdentity;
  recordEstimate?: (estimate: number) => void;
  signal?: AbortSignal;
}

/** The island owns durable writes; shared policy only chooses and summarizes a prefix. */
export function nodeCompactionOptions(options: NodeCompactionOptions) {
  return {
    dataDir: options.dataDir, area: 'tradewindConversation' as const,
    model: options.model, kind: 'conversation' as const,
    scopeKey: options.scopeKey, initialPromptTokens: options.initialPromptTokens,
    initialEstimateTokens: options.initialEstimateTokens, protectedPrefixCount: 1,
    prompt: tradewindCompactionGuidance({ scope: 'node', identity: options.identity }, options.prompt),
    signal: options.signal,
    archive: async (before: ContextMessage[]) => {
      await fs.mkdir(options.archiveDir, { recursive: true });
      await atomicWriteFile(path.join(options.archiveDir, `${Date.now()}-${randomUUID()}.json`),
        JSON.stringify(before));
      options.emit({ type: 'compact-start' });
    },
    commit: async (plan: { messages: ContextMessage[]; prefix: ContextMessage[]; summary: string }) => {
      await options.persist(plan.messages);
      options.messages.splice(0, options.messages.length, ...plan.messages);
      options.emit({ type: 'compact-done', archivedRounds: plan.prefix.length,
        summaryLength: plan.summary.length });
      options.emit({ type: 'context-compacted', messages: plan.messages.slice(1) });
    },
    onNotice: (notice: { message: string }) => options.emit({ type: 'compaction-notice',
      message: notice.message }),
  };
}

export function nodeCompactionCaller(llm: LLMCaller, options: NodeCompactionOptions): LLMCaller {
  return createCompactionCaller({ ...nodeCompactionOptions(options), llm: { call: async (...args) => {
    const result = await llm.call(...args);
    options.recordEstimate?.(estimateCompactionTokens(args[0]));
    return result;
  } } });
}

export async function compactNodeManually(options: NodeCompactionOptions): Promise<void> {
  await compactMessages({ ...nodeCompactionOptions(options), messages: options.messages,
    mode: 'full', reason: 'manual' });
}
