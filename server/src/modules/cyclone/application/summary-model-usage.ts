import { observeModelRequests, recordModelRequest,
  type ModelUsageProgress, type ModelRequestUsageEvent } from '../../../engine/shared/model-request-usage.js';

/** Manual summaries use the same request facts while keeping their owner's context untouched. */
export function withCycloneSummaryUsage<T>(owner: {
  get(): ModelUsageProgress | undefined;
  set(progress: ModelUsageProgress): void;
  persist(): Promise<unknown>;
  emit?(event: ModelRequestUsageEvent): void;
}, summarize: () => Promise<T>): Promise<T> {
  let writes = Promise.resolve();
  return observeModelRequests(event => {
    owner.set(recordModelRequest(owner.get(), event.request));
    writes = writes.then(async () => { await owner.persist(); owner.emit?.(event); });
    void writes.catch(() => undefined);
  }, async () => {
    try { return await summarize(); } finally { await writes; }
  });
}
