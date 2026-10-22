import { mutateDispatch, type CycloneDispatch } from './dispatch-store.js';

export const DISPATCH_ADMISSION_TIMEOUT_MS = 30_000;

/** Deferred room records become eligible only when their owning round releases them. */
export function activateDispatch(dataDir: string, workshopId: string, dispatchId: string, now?: number) {
  return mutateDispatch(dataDir, workshopId, dispatchId, item => {
    if (item.status !== 'queued' || item.deliveryReadyAt) return null;
    const ready = item.deliveryDeferred ? now ?? Date.now() : Date.parse(item.createdAt);
    return { ...item, deliveryDeferred: false, deliveryReadyAt: new Date(ready).toISOString(),
      admissionDeadlineAt: new Date(ready + DISPATCH_ADMISSION_TIMEOUT_MS).toISOString() };
  });
}

export async function claimDispatch(
  dataDir: string, workshopId: string, dispatchId: string, now?: number,
): Promise<{ item: CycloneDispatch | null; claimed: boolean }> {
  let claimed = false;
  const item = await mutateDispatch(dataDir, workshopId, dispatchId, current => {
    if (current.status !== 'queued' || current.deliveryDeferred) return null;
    const claimedAt = now ?? Date.now();
    const ready = current.deliveryReadyAt ?? current.createdAt;
    const deadline = current.admissionDeadlineAt
      ?? new Date(Date.parse(ready) + DISPATCH_ADMISSION_TIMEOUT_MS).toISOString();
    if (claimedAt >= Date.parse(deadline)) return busyWithdrawal(current, claimedAt);
    claimed = true;
    return { ...current, deliveryReadyAt: ready, admissionDeadlineAt: deadline,
      status: 'running', delivered: true, acceptedAt: new Date(claimedAt).toISOString(),
      error: undefined, errorCode: undefined, errorKind: undefined };
  });
  return { item, claimed };
}

export function withdrawExpiredDispatch(
  dataDir: string, workshopId: string, dispatchId: string, now?: number, force = false,
) {
  return mutateDispatch(dataDir, workshopId, dispatchId, item => {
    if (item.status !== 'queued') return null;
    const checkedAt = now ?? Date.now();
    if (!force && (item.deliveryDeferred || checkedAt < Date.parse(item.admissionDeadlineAt
      ?? new Date(Date.parse(item.deliveryReadyAt ?? item.createdAt) + DISPATCH_ADMISSION_TIMEOUT_MS).toISOString()))) return null;
    return busyWithdrawal(item, checkedAt);
  });
}

function busyWithdrawal(item: CycloneDispatch, now: number): CycloneDispatch {
  return { ...item, status: 'failed', delivered: false, activity: undefined, response: undefined,
    error: `目标工位「${item.targetSeatTitle}」30 秒内未接入，派发已撤回；未执行任务，可稍后重新交办`,
    errorCode: 'CYCLONE_TARGET_BUSY', errorKind: 'conflict', completedAt: new Date(now).toISOString() };
}
