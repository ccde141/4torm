import { findOperationRecords, inspectOperation,
  type CollaborationProbeItem } from '../../../api/collaboration';

/** Read the newest persisted run for one Cyclone operation after transient activity disappears. */
export async function readLatestCycloneFact(operationId: string): Promise<CollaborationProbeItem | null> {
  const records = await findOperationRecords('cyclone', { operationId, limit: 1 });
  const latest = records.items[0];
  return latest ? inspectOperation('cyclone', operationId, latest.runId) : null;
}

export async function isLatestCycloneRun(operationId: string, runId: string): Promise<boolean> {
  const records = await findOperationRecords('cyclone', { operationId, limit: 1 });
  return records.items[0]?.runId === runId;
}
