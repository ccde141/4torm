import { executionCapabilities } from './builtin-execution-capabilities.js';
import type { ExecutionCapabilityOwner } from './execution-capability-registry.js';
import { executionObserver } from './execution-observer.js';

/** Temporary delegates release only the surfaces created under their own identity. */
export async function closeExecutionCapabilityScope(owner: ExecutionCapabilityOwner): Promise<void> {
  for (const entry of executionObserver.list(owner.scope, owner.ownerId)) {
    const surface = executionCapabilities.findSurface(entry.viewer);
    try { await surface?.close?.({ id: entry.id, ...owner }); }
    catch (error) { console.warn('[execution-capability] 释放执行界面失败', error instanceof Error ? error.message : String(error)); }
  }
}
