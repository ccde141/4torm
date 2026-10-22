import type { SeatJournalRecord } from '../../../engine/cyclone/seat-event-journal.js';
import type { CycloneOperationSnapshot } from '../domain/operation-snapshot.js';

/** Merge with the existing seat identity; a contact is not a second parallel seat. */
export function mergeContactSnapshots(
  snapshots: CycloneOperationSnapshot[],
  contacts: SeatJournalRecord[],
): CycloneOperationSnapshot[] {
  const byOperation = new Map(snapshots.map(item => [item.operationId, item]));
  for (const item of contacts) {
    const operationId = `seat:${item.workshopId}:${item.seatId}`;
    const previous = byOperation.get(operationId);
    // A current module execution has the same seat lock and outranks old contact history.
    if (previous?.status === 'running' && previous.phase !== 'seat-contact') continue;
    if (previous?.updatedAt && previous.updatedAt > item.updatedAt) continue;
    byOperation.set(operationId, {
      operationId, parentOperationId: item.workshopId,
      title: `工位联络：${item.title}`, status: item.status,
      phase: 'seat-contact', updatedAt: item.updatedAt, agentId: item.agentId,
      ...(item.error ? { errorMessage: item.error } : {}),
      // No module runId: precise operation inspection must not pretend it can read this journal.
    });
  }
  return [...byOperation.values()];
}
