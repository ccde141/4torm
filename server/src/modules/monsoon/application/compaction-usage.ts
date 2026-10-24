import { observeModelRequests, type ModelRequestUsageEvent } from '../../../engine/shared/model-request-usage.js';
import type { FileMonsoonSessionRepository } from '../infrastructure/session-repository.js';

/** Manual compression has the same owner as the conversation, outside a chat turn. */
export function withMonsoonCompactionUsage<T>(sessions: FileMonsoonSessionRepository,
  identity: { agentId: string; sessionId: string }, run: () => Promise<T>,
  emit?: (event: ModelRequestUsageEvent) => void): Promise<T> {
  let writes = Promise.resolve();
  return observeModelRequests(event => {
    writes = writes.then(async () => {
      await sessions.updateModelUsage(identity.agentId, identity.sessionId, event.request);
      emit?.(event);
    });
    void writes.catch(() => undefined);
  }, async () => { try { return await run(); } finally { await writes; } });
}
