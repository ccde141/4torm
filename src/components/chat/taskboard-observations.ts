export interface TaskboardObservation {
  id: string;
  surfaceId?: string;
  kind?: 'terminal' | 'browser' | 'computer';
  viewer?: 'terminal' | 'browser' | 'computer';
  command: string;
  status: string;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
  error?: string;
  progress?: string;
  outputTruncated?: boolean;
  presentation?: 'embedded-visible' | 'external-visible' | 'hidden';
}

export function selectTaskboardObservations(items: TaskboardObservation[]): TaskboardObservation[] {
  return items.filter(isActive).sort((a, b) => a.startedAt - b.startedAt).slice(0, 3);
}

export function selectCurrentVisualObservation(items: TaskboardObservation[]): TaskboardObservation | undefined {
  const activeVisuals = items.filter(item =>
    isActive(item)
    && item.viewer !== 'terminal' && item.viewer !== undefined,
  );
  return activeVisuals.find(item => item.surfaceId === 'primary')
    ?? activeVisuals.sort((a, b) => b.startedAt - a.startedAt)[0];
}

export function selectRecentTaskboardObservations(items: TaskboardObservation[]): TaskboardObservation[] {
  return items
    .filter(item => !isActive(item))
    .sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt))
    .slice(0, 3);
}

export function formatObservationElapsed(startedAt: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1_000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function formatObservationStatus(status: string): string {
  if (status === 'completed') return '完成';
  if (status === 'cancelled') return '已关闭';
  if (status === 'crashed') return '已中断';
  return '失败';
}

function isActive(item: TaskboardObservation): boolean {
  return item.status === 'running' || item.status === 'waiting' || item.status === 'cancelling';
}
