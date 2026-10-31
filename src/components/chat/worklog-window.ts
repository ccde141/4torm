export const WORKLOG_WINDOW_SIZE = 80;

export interface WorklogWindow<T> {
  items: T[];
  start: number;
  end: number;
  total: number;
  previousEnd: number | null;
  nextEnd: number | null;
  followingLatest: boolean;
}

/** Display-only windows keep a fixed older endpoint while new records arrive. */
export function worklogWindow<T>(items: readonly T[], selectedEnd: number | null = null): WorklogWindow<T> {
  const total = items.length;
  const end = selectedEnd === null ? total : Math.max(0, Math.min(total, selectedEnd));
  const start = Math.max(0, end - WORKLOG_WINDOW_SIZE);
  return { items: items.slice(start, end), start, end, total,
    previousEnd: start > 0 ? start : null,
    nextEnd: end < total ? Math.min(total, end + WORKLOG_WINDOW_SIZE) : null,
    followingLatest: selectedEnd === null };
}

/** Window movement must not change the identity of a continuous source group. */
export function worklogRunStart<T>(items: readonly T[], index: number, inRun: (item: T) => boolean): number {
  if (index < 0 || index >= items.length || !inRun(items[index])) return index;
  let start = index;
  while (start > 0 && inRun(items[start - 1])) start--;
  return start;
}
