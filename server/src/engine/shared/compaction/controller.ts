import { createHash } from 'node:crypto';
import type { LLMCaller } from '../react/native-loop.js';
import type { ContextMessage } from '../types.js';
import { isProviderContextOverflow } from '../provider-request-error.js';
import type { CompactMessagesOptions, CompactionCallerOptions, CompactionCommit } from './contracts.js';
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
    const split = splitCompactionMessages(options.messages, { ...options,
      prefixRatio: options.reason === 'provider-overflow' ? 2 / 3 : policy.prefixRatio });
    if (!split) return null;
    const revision = fingerprint(options.messages);
    await options.archive?.(split.before, options.reason);
    const summary = await summarizeCompactionPrefix(options, split.prefix, options.signal, options.reason, policy);
    options.signal?.throwIfAborted();
    if (revision !== fingerprint(options.messages)) throw new Error('压缩期间会话已发生变化，原文未更改');
    const messages: ContextMessage[] = [...split.protected,
      { role: 'system', content: `[历史压缩记录]\n${summary}` }, ...split.tail];
    const plan: CompactionCommit = { ...split, summary, messages, mode: options.mode, reason: options.reason };
    await options.commit?.(plan);
    options.messages.splice(0, options.messages.length, ...messages);
    await options.onCompacted?.(plan);
    return plan;
  });
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
