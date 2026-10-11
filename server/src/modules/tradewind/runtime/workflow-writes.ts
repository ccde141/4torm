import { pushWorkflowChange } from '../../../engine/tradewind/streaming/unified-stream.js';
import type { TradewindWorkflowStore } from '../application/workflow-store.js';
import type { TradewindWorkflowWrites } from '../application/workflow-writes.js';

export function createTradewindWorkflowWrites(store: TradewindWorkflowStore): TradewindWorkflowWrites {
  return {
    save: async input => {
      const saved = await store.save(input);
      pushWorkflowChange({ workflowId: saved.workflowId, revision: saved.revision,
        change: input.expectedRevision === null ? 'created' : 'updated' });
      return saved;
    },
    remove: async (workflowId, expectedRevision) => {
      const removed = await store.remove(workflowId, expectedRevision);
      if (removed) pushWorkflowChange({ workflowId, revision: null, change: 'deleted' });
      return removed;
    },
  };
}
