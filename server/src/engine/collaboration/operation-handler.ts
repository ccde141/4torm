import type { ProbeItem } from '../../shared/probes/public.js';
import type { FeatureOperationHandler, OperationIdentity } from './contracts.js';

type OperationSnapshot = ProbeItem;

export function snapshotOperationHandler(
  snapshots: () => Promise<OperationSnapshot[]>,
  subscribe?: FeatureOperationHandler['subscribe'],
): FeatureOperationHandler {
  return {
    inspect: async identity => {
      const item = (await snapshots()).find(candidate => matches(candidate, identity));
      return item ? structuredClone(item) : null;
    },
    ...(subscribe ? { subscribe } : {}),
  };
}

function matches(snapshot: OperationSnapshot, identity: OperationIdentity): boolean {
  return snapshot.operationId === identity.operationId && snapshot.runId === identity.runId;
}
