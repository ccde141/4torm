import type { CycloneFeedEvent } from './cyclone-change-client';

/** Serialize version checks so a late response cannot supersede a newer seat update. */
export function createSeatHistoryRefresher(
  workshopId: string,
  seatId: string,
  readRevision: () => Promise<string | null>,
  currentRevision: () => string,
  reload: () => Promise<boolean>,
) {
  let stopped = false;
  let checking: Promise<void> | null = null;
  let queued = false;

  const check = async (): Promise<void> => {
    do {
      queued = false;
      const revision = await readRevision();
      if (stopped) return;
      if (revision && revision !== currentRevision()) await reload();
    } while (!stopped && queued);
  };

  const request = (queueIfBusy: boolean): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (checking) {
      if (queueIfBusy) queued = true;
      return checking;
    }
    checking = check().finally(() => { checking = null; });
    return checking;
  };

  return {
    poll: () => request(false),
    wake: (event: CycloneFeedEvent) => {
      if (event.type !== 'sync' && !(event.type === 'change'
        && event.workshopId === workshopId && event.scope === 'activity'
        && event.id === seatId)) return Promise.resolve();
      return request(true);
    },
    stop: () => { stopped = true; },
  };
}
