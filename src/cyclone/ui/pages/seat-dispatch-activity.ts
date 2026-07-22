import type { CycloneDispatch } from './dispatch-timeline.js';

const ACTIVE_STATUSES = new Set<CycloneDispatch['status']>(['queued', 'running']);

export function formatSeatDispatchOrigin(item: CycloneDispatch): string {
  return item.sourceKind === 'seat' ? '来自工位' : '来自群聊工位';
}

export function findActiveSeatDispatch(
  items: CycloneDispatch[],
  seatId: string,
): CycloneDispatch | null {
  const targeted = items.filter(item => (
    item.targetSeatId === seatId && ACTIVE_STATUSES.has(item.status)
  ));
  return targeted.find(item => item.status === 'running') ?? targeted[0] ?? null;
}

export function formatSeatDispatchActivity(
  item: CycloneDispatch,
): { label: string; target?: string } {
  const activity = item.activity;
  if (item.status === 'queued' || activity?.phase === 'waiting-agent') {
    return { label: '等待工位空闲' };
  }
  if (!activity) return { label: '异步任务执行中' };
  const elapsed = activity.elapsedSeconds ? ` · ${activity.elapsedSeconds}s` : '';
  if (activity.phase === 'llm-waiting') return { label: `等待模型响应${elapsed}` };
  if (activity.phase === 'model-output') return { label: `模型正在生成${elapsed}` };
  if (activity.phase === 'tool-preparing') {
    return { label: `${activity.tool ? `正在准备 ${activity.tool} 参数` : '正在准备工具参数'}${elapsed}` };
  }
  return {
    label: `${activity.tool ? `正在执行 ${activity.tool}` : '正在执行工具'}${elapsed}`,
    ...(activity.target ? { target: activity.target } : {}),
  };
}

export function dispatchesRequiringSeatReload(
  previous: ReadonlyMap<string, CycloneDispatch['status']>,
  items: CycloneDispatch[],
  seatId: string,
): string[] {
  return items.filter(item => (
    item.targetSeatId === seatId
    && ACTIVE_STATUSES.has(previous.get(item.id) ?? 'completed')
    && !ACTIVE_STATUSES.has(item.status)
  )).map(item => item.id);
}
