export type PresencePhase = 'entering' | 'present' | 'leaving';
export interface PresenceEntry<T> { key: string; item: T; phase: PresencePhase }

export function reconcilePresence<T>(
  previous: PresenceEntry<T>[], items: T[], keyOf: (item: T) => string,
): PresenceEntry<T>[] {
  const old = new Map(previous.map(entry => [entry.key, entry]));
  const keys = new Set<string>();
  const result = items.map(item => {
    const key = keyOf(item);
    if (keys.has(key)) throw new Error(`动画列表存在重复键：${key}`);
    keys.add(key);
    const prior = old.get(key);
    return { key, item, phase: prior
      ? prior.phase === 'leaving' ? 'present' : prior.phase : 'entering' } as PresenceEntry<T>;
  });
  previous.forEach((entry, index) => {
    if (!keys.has(entry.key)) {
      result.splice(Math.min(index, result.length), 0, { ...entry, phase: 'leaving' });
    }
  });
  return result;
}

export function removeExited<T>(entries: PresenceEntry<T>[], key: string): PresenceEntry<T>[] {
  return entries.filter(entry => entry.key !== key || entry.phase !== 'leaving');
}

export function settleEntered<T>(entries: PresenceEntry<T>[]): PresenceEntry<T>[] {
  return entries.map(entry => entry.phase === 'entering'
    ? { ...entry, phase: 'present' } : entry);
}
