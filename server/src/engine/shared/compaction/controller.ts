import { createHash, randomUUID } from 'node:crypto';
import type { LLMCaller } from '../react/native-loop.js';
import type { ContextMessage } from '../types.js';
import { isProviderContextOverflow } from '../provider-request-error.js';
import type { CompactMessagesOptions, CompactionCallerOptions, CompactionCommit, CompactionProgress } from './contracts.js';
import { estimateCompactionTokens } from './estimate.js';
import { loadCompactionPolicy } from './policy.js';
import { splitCompactionMessages } from './split.js';
import { summarizeCompactionPrefix } from './summary.js';

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
      prefixRatio: options.reason === 'provider-overflow' ? 2 / 3 : policy.prefixRatio });
    if (!split) return null;
    const revision = fingerprint(options.messages);
    const progress = { id: randomUUID(), operation: 'compact' as const,
      startedAt: Date.now(), reason: options.reason };
    const emit = (event: Pick<CompactionProgress, 'type'> & Partial<CompactionProgress>) =>
      observe(() => options.onProgress?.({ ...progress, ...event, updatedAt: Date.now() }));
    await emit({ type: 'compact-start' });
    let plan: CompactionCommit;
    try {
      options.signal?.throwIfAborted();
      await options.archive?.(structuredClone(split.before), options.reason);
      options.signal?.throwIfAborted();
      const summary = await summarizeCompactionPrefix(options, split.prefix, options.signal, options.reason, policy);
      options.signal?.throwIfAborted();
      if (revision !== fingerprint(options.messages)) throw new Error('压缩期间会话已发生变化，原文未更改');
      // Retained messages stay identical objects: temporary continuation frames and live
      // references must survive. Only the material sent to the summarizer is detached.
      const messages: ContextMessage[] = [...source.slice(0, split.protected.length),
        { role: 'system', content: `[历史压缩记录]\n${summary}` }, ...source.slice(source.length - split.tail.length)];
      plan = { ...split, summary, messages, mode: options.mode, reason: options.reason };
      await options.commit?.(plan, options.signal);
    } catch (error) {
      await emit({ type: 'compact-failed', aborted: options.signal?.aborted
        || (error instanceof Error && error.name === 'AbortError'),
      message: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    // Commit is the point of no return: late cancellation or observer failure cannot roll it back.
    options.messages.splice(0, options.messages.length, ...plan.messages);
    await observe(() => options.onCompacted?.(plan));
    await emit({ type: 'compact-done', summaryLength: plan.summary.length,
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
  return { call: async (messages, callOptions, onChunk, signal, tools, onReasoning, onToolProgress) => {
    const policy = await loadCompactionPolicy(options.dataDir);
    const estimate = estimateCompactionTokens(messages);
    if (baselineEstimate === undefined) baselineEstimate = estimate;
    const measured = promptTokens === undefined ? estimate
      : Math.max(0, promptTokens + estimate - baselineEstimate);
    if (policy.enabled && measured >= policy.thresholds[options.area]) {
      await compactMessages({ ...options, messages, mode: 'partial',
        reason: 'threshold', signal, policy });
    }
    const invoke = () => options.llm.call(messages, callOptions, onChunk, signal, tools, onReasoning, onToolProgress);
    let result: Awaited<ReturnType<LLMCaller['call']>>;
    try { result = await invoke(); } catch (error) {
      if (!isProviderContextOverflow(error) || signal?.aborted) throw error;
      const recovered = await compactMessages({ ...options, messages, mode: 'partial',
        reason: 'provider-overflow', signal, policy });
      if (!recovered) throw error;
      result = await invoke(); // Exactly one retry of this rejected request; no tool loop restart.
    }
    promptTokens = result.usage?.promptTokens;
    baselineEstimate = estimateCompactionTokens(messages);
    return result;
  } };
}

async function serialize<T>(options: CompactMessagesOptions, run: () => Promise<T>): Promise<T> {
  const key = options.scopeKey ? `${options.dataDir}:${options.scopeKey}` : null;
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
