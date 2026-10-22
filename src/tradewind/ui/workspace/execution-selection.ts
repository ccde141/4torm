import type { CollaborationProbeItem } from '../../../api/collaboration';

export function selectWorkflowExecution(
  probes: CollaborationProbeItem[], workflowId: string, receipt?: CollaborationProbeItem,
): CollaborationProbeItem | undefined {
  const fact = probes.find(item => !item.parentOperationId && item.operationId === workflowId);
  if (receipt?.operationId === workflowId && receipt.runId !== fact?.runId) return receipt;
  return fact;
}

/** A start receipt replaces its old root and children until the central snapshot catches up. */
export function projectExecutionReceipts(probes: CollaborationProbeItem[], receipts: Record<string, CollaborationProbeItem>) {
  const pending = Object.values(receipts).filter(receipt => !probes.some(fact => !fact.parentOperationId
    && fact.operationId === receipt.operationId && fact.runId === receipt.runId));
  const replacing = new Set(pending.map(item => item.operationId));
  return [...probes.filter(item => !replacing.has(item.parentOperationId ?? item.operationId)), ...pending];
}
