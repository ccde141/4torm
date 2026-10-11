import type { FeatureRecordHandler } from '../../../engine/collaboration/contracts.js';
import type { FileMonsoonRunRepository } from '../infrastructure/run-repository.js';
import { loadSessionTitles, sessionTitle,
  type MonsoonTitleSource } from '../application/title-projection.js';

export function createMonsoonRecordPort(
  runs: FileMonsoonRunRepository, titles?: MonsoonTitleSource,
): FeatureRecordHandler {
  return {
    list: async () => {
      const records = await runs.history();
      const byAgent = await loadSessionTitles(records, titles);
      return records.map(record => ({ operationId: record.sessionId, runId: record.runId,
        title: sessionTitle(record.agentId, record.sessionId, record.sessionId, byAgent),
        status: record.status, timestamp: record.createdAt ?? record.updatedAt,
        agentId: record.agentId, sessionId: record.sessionId }));
    },
    read: async (_context, identity) => {
      const fact = await runs.getRun(identity.operationId, identity.runId);
      return fact ? { fact, detailAvailable: false } : null;
    },
  };
}
