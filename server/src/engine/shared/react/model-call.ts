import type { ContextMessage } from '../types.js';
import type { ToolDef } from '../tool-defs-loader.js';
import type { ToolPreparationProgress } from '../tool-progress.js';
import { observeModelRequests } from '../model-request-usage.js';
import type { LLMCaller, ReActStreamEvent } from './native-loop.js';
import { HEARTBEAT_INTERVAL_MS } from './limits.js';

/** Preparation and recovery remain inside the same task; cancellation belongs to its owner. */
export function callPreparedModel(llm: LLMCaller, messages: ContextMessage[], signal: AbortSignal | undefined,
  callbacks: { onChunk?: (chunk: string) => void; onReasoning?: (chunk: string) => void;
    onToolProgress?: (progress: ToolPreparationProgress) => void; onEvent?: (event: ReActStreamEvent) => void },
  tools?: ToolDef[]): ReturnType<LLMCaller['call']> {
  return observeModelRequests(callbacks.onEvent, async () => {
    await llm.prepare?.(messages, undefined, signal, tools);
    for (;;) {
      if (signal?.aborted) throw signal.reason ?? new Error('Model request cancelled');
      let received = false;
      const progress = { ...callbacks,
        onChunk: callbacks.onChunk && ((chunk: string) => { received ||= !!chunk; callbacks.onChunk!(chunk); }),
        onReasoning: callbacks.onReasoning && ((chunk: string) => { received ||= !!chunk; callbacks.onReasoning!(chunk); }),
        onToolProgress: callbacks.onToolProgress && ((event: ToolPreparationProgress) => { received = true; callbacks.onToolProgress!(event); }) };
      try { return await observedCall(llm, messages, signal, progress, tools); }
      catch (error) {
        if (received || signal?.aborted || !await llm.recover?.(error, messages, signal)) throw error;
      }
    }
  });
}

async function observedCall(llm: LLMCaller, messages: ContextMessage[], signal: AbortSignal | undefined,
  callbacks: Parameters<typeof callPreparedModel>[3], tools?: ToolDef[]) {
  const startedAt = Date.now();
  let received = false;
  const heartbeat = callbacks.onEvent ? setInterval(() => {
    if (!received) callbacks.onEvent!({ type: 'heartbeat', phase: 'llm-waiting', elapsed: Date.now() - startedAt });
  }, HEARTBEAT_INTERVAL_MS) : undefined;
  try {
    return await llm.call(messages, undefined,
      callbacks.onChunk && (chunk => { received = true; callbacks.onChunk!(chunk); }), signal, tools,
      callbacks.onReasoning && (chunk => { received = true; callbacks.onReasoning!(chunk); }),
      callbacks.onToolProgress && (progress => { received = true; callbacks.onToolProgress!(progress); }));
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
}
