import type { Agent } from '../../types';
import type { AgentActivityView } from './dashboard-activity';
import type { CollaborationFeature, CollaborationStatus } from '../../api/collaboration';
import type { MessageKey } from '../../i18n/locale';

const statusKeys: Record<CollaborationStatus | 'offline' | 'unknown', MessageKey> = {
  idle: 'dashboard.status.idle', queued: 'dashboard.status.queued',
  running: 'dashboard.status.running', waiting: 'dashboard.status.waiting',
  completed: 'dashboard.status.completed', aborted: 'dashboard.status.aborted',
  failed: 'dashboard.status.failed', crashed: 'dashboard.status.crashed',
  offline: 'dashboard.status.offline', unknown: 'dashboard.status.unknown',
};
const featureKeys: Record<CollaborationFeature, MessageKey> = {
  monsoon: 'dashboard.feature.monsoon', convection: 'dashboard.feature.convection',
  cyclone: 'dashboard.feature.cyclone', tradewind: 'dashboard.feature.tradewind',
  tide: 'dashboard.feature.tide',
};

export const statusKey = (status: keyof typeof statusKeys): MessageKey => statusKeys[status];
export const featureKey = (feature: CollaborationFeature): MessageKey => featureKeys[feature];

export function activityStatusKey(activity: AgentActivityView): MessageKey {
  return statusKey(activity.kind === 'running' && activity.item?.status === 'queued'
    ? 'queued' : activity.kind);
}

export function activityStatusLabel(activity: AgentActivityView, t: (key: MessageKey) => string): string {
  const label = t(activityStatusKey(activity));
  return activity.kind === 'running' && !activity.item && activity.feature
    ? `${label} · ${t(featureKey(activity.feature))}` : label;
}

export function activitySummaryKey(activity: AgentActivityView): MessageKey | undefined {
  if (activity.item) return undefined;
  const summaries = {
    idle: ['当前未观察到执行中的事项', 'dashboard.summary.idle'],
    offline: ['当前模型配置不可用', 'dashboard.summary.offline'],
    unknown: ['当前无法完整确认执行状态', 'dashboard.summary.unknown'],
    running: ['活动已确认，尚无可关联的运行详情', 'dashboard.summary.running'],
    waiting: ['活动已确认，尚无可关联的运行详情', 'dashboard.summary.running'],
  } as const;
  const [source, key] = summaries[activity.kind];
  return activity.summary === source ? key : undefined;
}

export function recordTitle(record: { title: string; operationId: string; runId?: string }) {
  const title = record.title.trim();
  return title && title !== record.operationId
    && title !== record.operationId.split(':').at(-1)
    && title !== record.runId ? title : undefined;
}

export function cardDetails(agent: Agent, activity: AgentActivityView) {
  const separator = agent.model.lastIndexOf(':');
  return {
    model: separator < 0 ? agent.model : agent.model.slice(separator + 1),
    workspace: agent.workspaceDisplayPath || agent.config?.workspace
      || `data/agents/${agent.id}/.workspace/`,
    recent: activity.item || !activity.recent ? undefined : {
      title: recordTitle(activity.recent),
      status: activity.recent.status,
      feature: activity.recentFeature,
    },
    feature: activity.feature,
  };
}

export function isAbsoluteWorkspacePath(value: string): boolean {
  return /^(?:[a-zA-Z]:[\\/]|[\\/])/.test(value);
}

export function workspaceDisplayLabel(value: string): string {
  return isAbsoluteWorkspacePath(value) || value === '.' || value.startsWith('./')
    ? value : `./${value}`;
}
