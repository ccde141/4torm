import type { LLMCaller } from './react/native-loop.js';
import { observeModelRequests, recordModelRequest, type ModelUsageProgress } from './model-request-usage.js';

/** The owner supplies storage; this adapter never selects another feature's files. */
export function trackModelUsage(llm: LLMCaller, owner: {
  get(): ModelUsageProgress | undefined;
  set(progress: ModelUsageProgress): void;
  persist(): Promise<unknown>;
}): LLMCaller {
  let writes = Promise.resolve();
  const observe = <T>(run: () => Promise<T>): Promise<T> => observeModelRequests(event => {
    owner.set(recordModelRequest(owner.get(), event.request));
    writes = writes.then(async () => { await owner.persist(); });
    // Errors are rethrown at the owner boundary; do not create unhandled rejections mid-stream.
    void writes.catch(() => undefined);
  }, async () => {
    try { return await run(); } finally { await writes; }
  }, true);
  return {
    prepare: llm.prepare ? (...args) => observe(() => llm.prepare!(...args)) : undefined,
    recover: llm.recover ? (...args) => observe(() => llm.recover!(...args)) : undefined,
    call: (...args) => observe(() => llm.call(...args)),
  };
}
