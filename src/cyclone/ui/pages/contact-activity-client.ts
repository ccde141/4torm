import { backendFetch } from '../../../lib/backend-client';
import { subscribeCycloneChanges } from './cyclone-change-client';
import { projectContactResult, type ContactResultDisplay } from './contact-result';

/** Visible conversations reconcile pending contact cards from the ticket's authoritative read port. */
export function watchContactActivity(workshopId: string, ids: string[],
  onResult: (id: string, result: ContactResultDisplay) => void, onError: (error: Error) => void): () => void {
  const pending = new Set(ids);
  const controller = new AbortController();
  let running = false;
  let dirty = false;
  const refresh = async () => {
    if (running) { dirty = true; return; }
    if (controller.signal.aborted || !pending.size) return;
    running = true;
    dirty = false;
    try {
      const results = await Promise.allSettled([...pending].map(async id => {
        const response = await backendFetch(`/api/cyclone/workshop/${encodeURIComponent(workshopId)}/contact/${encodeURIComponent(id)}`,
          { signal: controller.signal });
        const value = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(value.error || `Contact status: ${response.status}`);
        const result = projectContactResult(JSON.stringify(value));
        if (value.workshopId !== workshopId || result.communicationId !== id || !result.deliveryState) {
          throw new Error('联络记录身份或状态无效');
        }
        if (result.status !== 'running') pending.delete(id);
        onResult(id, { ...result, replyTruncated: value.nextOffset !== undefined });
      }));
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    } catch (error) {
      if (!controller.signal.aborted) onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      running = false;
      if (dirty && !controller.signal.aborted) void refresh();
    }
  };
  const unsubscribe = subscribeCycloneChanges(event => {
    if (event.type === 'sync' || event.type === 'change' && event.workshopId === workshopId
      && (event.scope === 'activity' || event.scope === 'workshop')) void refresh();
  });
  void refresh();
  return () => { controller.abort(); unsubscribe(); };
}
