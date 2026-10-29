import { createHash, randomUUID } from 'node:crypto';
import type { LLMCaller } from '../react/native-loop.js';
import type { ContextMessage } from '../types.js';
import { isProviderContextOverflow } from '../provider-request-error.js';
import type { CompactMessagesOptions, CompactionCallerOptions, CompactionCommit, CompactionProgress } from './contracts.js';
import { estimateCompactionTokens } from './estimate.js';
import { loadCompactionPolicy } from './policy.js';
import { splitCompactionMessages } from './split.js';
import { summarizeCompactionPrefix } from './summary.js';
import { resolveModelPromptBudget } from '../llm-bridge.js';
import { estimateTextTokens } from './estimate.js';
import { CompactionNoGainError } from './errors.js';
import { isHumanContextMessage } from '../context-origin.js';

const gates = new Map<string, Promise<unknown>>();
const arrayGates = new WeakMap<ContextMessage[], Promise<unknown>>();

/** Runtime mutation follows the owner's successful durable commit, never a speculative summary. */
export async function compactMessages(options: CompactMessagesOptions): Promise<CompactionCommit | null> {
  const requestedRevision = fingerprint(options.messages);
  return serialize(options, async () => {
    // Another boundary already committed this same live array while this request was queued.
    if (requestedRevision !== fingerprint(options.messages)) return null;
    const policy = options.policy ?? await loadCompactionPolicy(options.dataDir);
    const source = [...options.messages];
    const split = splitCompactionMessages(structuredClone(source), { ...options,
      recentHumanTurns: options.recentHumanTurns ?? (options.kind === 'meeting' ? 3 : 4),
      prefixRatio: options.reason === 'provider-overflow' ? 2 / 3 : policy.prefixRatio });
    if (!split) return null;
    const keep = [...source.slice(0, split.protected.length),
      ...source.slice(source.length - split.tail.length)];
    const releasedTokens = estimateCompactionTokens(source) - estimateCompactionTokens(keep);
    if (options.reason === 'threshold' && !options.signal?.aborted
      && releasedTokens <= estimateCompactionTokens([{ role: 'system', content: '[历史压缩记录]\n' }])) return null;
    const revision = fingerprint(options.messages);
    const progress = { id: randomUUID(), operation: 'compact' as const,
      startedAt: Date.now(), reason: options.reason };
    const emit = (event: Pick<CompactionProgress, 'type'> & Partial<CompactionProgress>) =>
      observe(() => options.onProgress?.({ ...progress, ...event, updatedAt: Date.now() }));
    const signal = options.signal;
    let plan: CompactionCommit;
    try {
      await emit({ type: 'compact-start' });
      signal?.throwIfAborted();
      await options.archive?.(structuredClone(split.before), options.reason);
      signal?.throwIfAborted();
      const summaryContext = options.summaryContext ?? { messages: split.protected };
      const resumedKeep = [...summaryContext.messages, ...source.slice(source.length - split.tail.length)];
      const requestOverheadTokens = Math.max(options.requestOverheadTokens ?? 0,
        estimateTextTokens(JSON.stringify(summaryContext.tools ?? [])));
      const summaryTokenBudget = await remainingSummaryBudget({ ...options, requestOverheadTokens }, resumedKeep);
      const summary = await summarizeCompactionPrefix({ ...options, summaryTokenBudget, summaryContext },
        split.prefix, signal, options.reason, policy);
      signal?.throwIfAborted();
      if (revision !== fingerprint(options.messages)) throw new Error('压缩期间会话已发生变化，原文未更改');
      // Retained messages stay identical objects: temporary continuation frames and live
      // references must survive. Only the material sent to the summarizer is detached.
      const messages: ContextMessage[] = [...source.slice(0, split.protected.length),
        { role: 'system', content: `[历史压缩记录]\n${summary}` },
        ...source.slice(source.length - split.tail.length)];
      if (estimateCompactionTokens(messages) >= estimateCompactionTokens(source)) {
        throw new CompactionNoGainError();
      }
      plan = { ...split, summary, messages,
        mode: options.mode, reason: options.reason };
      await options.commit?.(plan, signal);
    } catch (error) {
      const failure = signal?.aborted ? signal.reason ?? error : error;
      const skipped = !signal?.aborted && options.reason === 'threshold' && error instanceof CompactionNoGainError;
      await emit({ type: 'compact-failed', aborted: options.signal?.aborted
        || (failure instanceof Error && failure.name === 'AbortError'),
      message: skipped ? '压缩未减小上下文，保留原文并继续执行' : failure instanceof Error ? failure.message : String(failure) });
      if (skipped) return null;
      throw failure;
    }
    // Commit is the point of no return: late cancellation or observer failure cannot roll it back.
    options.messages.splice(0, options.messages.length, ...plan.messages);
    await observe(() => options.onCompacted?.(plan));
    await emit({ type: 'compact-done', summary: plan.summary, summaryLength: plan.summary.length,
      archivedMessages: plan.prefix.length });
    return plan;
  });
}

async function observe(notify: () => void | Promise<void>): Promise<void> {
  try { await notify(); } catch (error) {
    // Delivery failure is visible, but a transport observer cannot undo the committed context.
    console.warn('[compaction] 生命周期通知失败', error instanceof Error ? error.message : String(error));
  }
}

/** Both text/native ReAct and continuations call this same model boundary; tools are never replayed. */
export function createCompactionCaller(options: CompactionCallerOptions): LLMCaller {
  let promptTokens = options.initialPromptTokens;
  let baselineEstimate = options.initialEstimateTokens;
  let requestOverheadTokens = 0;
  let summaryContext = options.summaryContext;
  let deferredThreshold: { estimate: number; policy: string; humans: string[] } | undefined;
  const update = (messages: ContextMessage[], usage?: { promptTokens: number }) => {
    promptTokens = usage?.promptTokens;
    baselineEstimate = estimateCompactionTokens(messages);
  };
  return { prepare: async (messages, callOptions, signal, tools) => {
    await options.llm.prepare?.(messages, callOptions, signal, tools);
    const firstHistory = messages.findIndex(message => message.role !== 'system');
    const protectedCount = options.protectedPrefixCount ?? (firstHistory < 0 ? messages.length : firstHistory);
    summaryContext = { ...options.summaryContext,
      messages: options.summaryContext?.messages ?? messages.slice(0, protectedCount),
      tools: tools ?? options.summaryContext?.tools,
      historyToolTransport: options.summaryContext?.historyToolTransport ?? (tools?.length ? 'native' : 'text') };
    const policy = await loadCompactionPolicy(options.dataDir);
    const estimate = estimateCompactionTokens(messages);
    if (baselineEstimate === undefined) baselineEstimate = estimate;
    const measured = promptTokens === undefined ? estimate
      : Math.max(0, promptTokens + estimate - baselineEstimate);
    requestOverheadTokens = Math.max(0, measured - estimate, estimateTextTokens(JSON.stringify(tools ?? [])));
    if (policy.enabled && measured >= policy.thresholds[options.area]) {
      const signature = JSON.stringify([policy.prefixRatio, policy.modelMode, policy.fixedModel, policy.thresholds[options.area]]);
      const humans = recentHumanContent(messages);
      const deferred = deferredThreshold;
      // A preserved human prefix can remain above the threshold after a no-op attempt.
      // New work, reduced history or a changed policy can make a later attempt useful.
      if (deferred?.policy === signature && estimate >= deferred.estimate
        && humans.length === deferred.humans.length
        && humans.every((content, index) => content === deferred.humans[index])
        && estimate < deferred.estimate + Math.max(256, Math.ceil(deferred.estimate * 0.05))) return;
      const plan = await compactMessages({ ...options, messages, mode: 'partial',
        reason: 'threshold', signal, policy, requestOverheadTokens, summaryContext });
      if (plan) { deferredThreshold = undefined; update(messages); }
      else deferredThreshold = { estimate, policy: signature, humans };
    } else deferredThreshold = undefined;
  }, recover: async (error, messages, signal) => {
    if (!isProviderContextOverflow(error) || signal?.aborted) return false;
    const recovered = await compactMessages({ ...options, messages, mode: 'partial',
      reason: 'provider-overflow', signal, requestOverheadTokens, summaryContext });
    if (recovered) { deferredThreshold = undefined; update(messages); }
    return !!recovered;
  }, call: async (messages, callOptions, onChunk, signal, tools, onReasoning, onToolProgress) => {
    const result = await options.llm.call(messages, callOptions, onChunk, signal, tools, onReasoning, onToolProgress);
    update(messages, result.usage);
    return result;
  } };
}

function recentHumanContent(messages: readonly ContextMessage[]): string[] {
  const content: string[] = [];
  for (let index = messages.length - 1; index >= 0 && content.length < 4; index--) {
    if (isHumanContextMessage(messages[index])) content.push(messages[index].content);
  }
  return content;
}

async function remainingSummaryBudget(options: CompactMessagesOptions, retained: ContextMessage[]): Promise<number | undefined> {
  // Injected summary ports may have no provider identity (isolated owners/tests).
  const inputTokens = options.resolveSummaryBudget ? undefined : await resolveModelPromptBudget(
    options.dataDir, options.model || (options.kind === 'meeting' ? options.chairModel ?? '' : ''));
  const remaining = inputTokens === undefined ? options.summaryTokenBudget
    : Math.min(options.summaryTokenBudget ?? Infinity,
      inputTokens - estimateCompactionTokens(retained) - (options.requestOverheadTokens ?? 0) - 256);
  if (remaining !== undefined && (!Number.isFinite(remaining) || remaining < 1)) {
    throw new Error('保留近期会话后，上下文容量不足以容纳历史交接记录，原文未更改');
  }
  return remaining === undefined ? undefined : Math.floor(remaining);
}

async function serialize<T>(options: CompactMessagesOptions, run: () => Promise<T>): Promise<T> {
  const key = options.scopeKey ? JSON.stringify([options.dataDir, options.scopeKey]) : null;
  const previous = key ? gates.get(key) : arrayGates.get(options.messages);
  const current = (previous ?? Promise.resolve()).catch(() => undefined).then(run);
  if (key) gates.set(key, current); else arrayGates.set(options.messages, current);
  try { return await current; } finally {
    if (key && gates.get(key) === current) gates.delete(key);
    if (!key && arrayGates.get(options.messages) === current) arrayGates.delete(options.messages);
  }
}

function fingerprint(messages: readonly ContextMessage[]): string {
  return createHash('sha256').update(JSON.stringify(messages)).digest('hex');
}
