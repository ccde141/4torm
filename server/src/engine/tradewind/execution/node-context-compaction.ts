import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteFile } from '../../shared/atomic-io.js';
import { compactMessages, createCompactionCaller, estimateCompactionTokens } from '../../shared/compaction/index.js';
import type { ContextMessage } from '../../shared/types.js';
import type { LLMCaller } from '../../shared/react/native-loop.js';
import type { NodeRunnerEvent } from './node-runner.js';
import { tradewindCompactionGuidance, type NodeCompactionIdentity } from './compaction-guidance.js';
import { projectNodeHistory } from './node-history-view.js';

interface NodeCompactionOptions {
  dataDir: string;
  model: string;
  scopeKey: string;
  archiveDir: string;
  messages: ContextMessage[];
  persist: (messages: ContextMessage[], signal?: AbortSignal) => Promise<void>;
  serialize?: (write: () => Promise<void>) => Promise<void>;
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
  // ReAct owns a working copy. Runtime facts appended to the node must survive its later commit.
  let ownerBefore = options.messages.slice();
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
    },
    commit: async (plan: { messages: ContextMessage[]; prefix: ContextMessage[]; summary: string }, signal?: AbortSignal) => {
      const commit = async () => {
        (signal ?? options.signal)?.throwIfAborted();
        if (!ownerBefore.every((message, index) => options.messages[index] === message)) {
          throw new Error('压缩期间节点上下文已被替换，原文未更改');
        }
        const ownerLength = options.messages.length;
        plan.messages.push(...options.messages.slice(ownerBefore.length));
        await options.persist(plan.messages, signal ?? options.signal);
        // Appends during IO already queued a normal write behind this commit. Keep them in both
        // the live node and ReAct's plan; that queued write reads the committed owner, never old history.
        plan.messages.push(...options.messages.slice(ownerLength));
        options.messages.splice(0, options.messages.length, ...plan.messages);
        ownerBefore = options.messages.slice();
      };
      await (options.serialize ? options.serialize(commit) : commit());
    },
    onCompacted: (plan: { messages: ContextMessage[] }) => {
      options.emit({ type: 'context-compacted', messages: projectNodeHistory(plan.messages.slice(1)) });
    },
    onProgress: options.emit,
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
  await compactMessages({ ...nodeCompactionOptions(options), messages: [...options.messages],
    mode: 'full', reason: 'manual' });
}
