import type { CycloneDispatch } from './dispatch-timeline.js';
import type { MessageKey, MessageValues } from '../../../i18n/locale.js';

type Translate = (key: MessageKey, values?: MessageValues) => string;

const ACTIVE_STATUSES = new Set<CycloneDispatch['status']>(['queued', 'running']);

export function formatSeatDispatchOrigin(item: CycloneDispatch, t?: Translate): string {
  if (!t) return item.sourceKind === 'seat' ? '来自工位' : '来自群聊工位';
  return item.sourceKind === 'seat' ? t('cyclone.dispatch.originSeat') : t('cyclone.dispatch.originRoom');
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
  t?: Translate,
): { label: string; target?: string } {
  const activity = item.activity;
  if (item.status === 'queued' || activity?.phase === 'waiting-agent') {
    return { label: t ? t('cyclone.dispatch.waitingSeat') : '等待工位空闲' };
  }
  if (!activity) return { label: t ? t('cyclone.dispatch.asyncRunning') : '异步任务执行中' };
  const elapsed = activity.elapsedSeconds ? ` · ${activity.elapsedSeconds}s` : '';
  if (activity.phase === 'llm-waiting') return { label: t ? t('cyclone.dispatch.waitingModel', { elapsed }) : `等待模型响应${elapsed}` };
  if (activity.phase === 'model-output') return { label: t ? t('cyclone.dispatch.modelOutput', { elapsed }) : `模型正在生成${elapsed}` };
  if (activity.phase === 'tool-preparing') {
    if (!t) return { label: `${activity.tool ? `正在准备 ${activity.tool} 参数` : '正在准备工具参数'}${elapsed}` };
    return { label: activity.tool
      ? t('cyclone.dispatch.preparingTool', { tool: activity.tool, elapsed })
      : t('cyclone.dispatch.preparingToolFallback', { elapsed }) };
  }
  return {
    label: t
      ? activity.tool
        ? t('cyclone.dispatch.runningTool', { tool: activity.tool, elapsed })
        : t('cyclone.dispatch.runningToolFallback', { elapsed })
      : `${activity.tool ? `正在执行 ${activity.tool}` : '正在执行工具'}${elapsed}`,
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
