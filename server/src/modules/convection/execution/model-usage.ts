import { observeModelRequests, recordModelRequest } from '../../../engine/shared/model-request-usage.js';
import type { ConvectionSessionData } from '../infrastructure/session-store.js';
import { writeConvectionModelUsage } from '../infrastructure/model-usage-store.js';
import type { ConvectionEventSink } from './stream-events.js';

/** The session lease owns one round; sidecars cannot roll back concurrent history commits. */
export async function withConvectionModelUsage<T>(dataDir: string, session: ConvectionSessionData,
  kind: 'public' | 'chair', emit: ConvectionEventSink | undefined,
  run: (observed: ConvectionEventSink) => Promise<T>): Promise<T> {
  const field = kind === 'public' ? 'publicModelUsage' : 'chairModelUsage';
  let pending = Promise.resolve();
  const observed: ConvectionEventSink = event => {
    if (event.type === 'model-request') {
      const usage = recordModelRequest(session[field], event.request);
      session[field] = usage;
      pending = pending.then(() => writeConvectionModelUsage(dataDir, session.id, kind, usage));
      // The owner awaits the original promise below; do not leak an unhandled rejection while streaming.
      void pending.catch(() => {});
    }
    emit?.(event);
  };
  try { return await observeModelRequests(observed, () => run(observed)); }
  finally { await pending; }
}
