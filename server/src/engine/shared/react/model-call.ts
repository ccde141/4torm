import type { ContextMessage } from '../types.js';
import type { ToolDef } from '../tool-defs-loader.js';
import type { ToolPreparationProgress } from '../tool-progress.js';
import { observeModelRequests } from '../model-request-usage.js';
import type { LLMCaller, ReActStreamEvent } from './native-loop.js';
import { HEARTBEAT_INTERVAL_MS, LLM_TIMEOUT_MS } from './limits.js';

export class ModelCallTimeout extends Error {}

/** Preparation/recovery have their own owner-managed deadline; only inference uses this timer. */
export function callPreparedModel(llm: LLMCaller, messages: ContextMessage[], signal: AbortSignal | undefined,
  callbacks: { onChunk?: (chunk: string) => void; onReasoning?: (chunk: string) => void;
    onToolProgress?: (progress: ToolPreparationProgress) => void; onEvent?: (event: ReActStreamEvent) => void },
  tools?: ToolDef[]): ReturnType<LLMCaller['call']> {
  return observeModelRequests(callbacks.onEvent, async () => {
    await llm.prepare?.(messages, undefined, signal, tools);
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw signal.reason ?? new Error('Model request cancelled');
      try { return await timedCall(llm, messages, signal, callbacks, tools); }
      catch (error) {
        if (attempt || signal?.aborted || !await llm.recover?.(error, messages, signal)) throw error;
      }
    }
  });
}

async function timedCall(llm: LLMCaller, messages: ContextMessage[], signal: AbortSignal | undefined,
  callbacks: Parameters<typeof callPreparedModel>[3], tools?: ToolDef[]) {
  const controller = new AbortController();
  const startedAt = Date.now();
  let timedOut = false;
  let received = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, LLM_TIMEOUT_MS);
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const heartbeat = callbacks.onEvent ? setInterval(() => {
    if (!received) callbacks.onEvent!({ type: 'heartbeat', phase: 'llm-waiting', elapsed: Date.now() - startedAt });
  }, HEARTBEAT_INTERVAL_MS) : undefined;
  try {
    return await llm.call(messages, undefined,
      callbacks.onChunk && (chunk => { received = true; callbacks.onChunk!(chunk); }), controller.signal, tools,
      callbacks.onReasoning && (chunk => { received = true; callbacks.onReasoning!(chunk); }),
      callbacks.onToolProgress && (progress => { received = true; callbacks.onToolProgress!(progress); }));
  } catch (error) {
    if (timedOut) throw new ModelCallTimeout('模型响应超时', { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
    if (heartbeat) clearInterval(heartbeat);
    signal?.removeEventListener('abort', abort);
  }
}
