type BulletinListener = (workshopId: string) => void;
const listenersByDataDir = new Map<string, Set<BulletinListener>>();

export function subscribeBulletinChanges(dataDir: string, listener: BulletinListener): () => void {
  const listeners = listenersByDataDir.get(dataDir) ?? new Set<BulletinListener>();
  listeners.add(listener);
  listenersByDataDir.set(dataDir, listeners);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) listenersByDataDir.delete(dataDir);
  };
}

export function notifyBulletinChange(dataDir: string, workshopId: string): void {
  const listeners = listenersByDataDir.get(dataDir);
  if (!listeners) return;
  for (const listener of listeners) {
    try { listener(workshopId); }
    catch { listeners.delete(listener); }
  }
  if (!listeners.size) listenersByDataDir.delete(dataDir);
}
