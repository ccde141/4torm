import type { Agent } from '../../types';
import type {
  CollaborationFeature, CollaborationProbeItem, CollaborationSnapshot,
  OperationRecordSummary,
} from '../../api/collaboration';

export type AgentActivityKind = 'running' | 'waiting' | 'idle' | 'offline' | 'unknown';
export interface AgentActivityEvent {
  feature: CollaborationFeature;
  item: CollaborationProbeItem;
  record?: OperationRecordSummary;
}
export interface AgentActivityView {
  kind: AgentActivityKind;
  label: string;
  summary: string;
  source: string;
  observedAt?: string;
  feature?: CollaborationFeature;
  item?: CollaborationProbeItem;
  recent?: CollaborationProbeItem;
  recentFeature?: CollaborationFeature;
  events: AgentActivityEvent[];
  complete: boolean;
}

const FEATURE_LABELS: Record<CollaborationFeature, string> = {
  monsoon: '季风', convection: '对流', cyclone: '气旋', tradewind: '信风', tide: '潮汐',
};
const ACTIVE = new Set(['queued', 'running', 'waiting']);

export function projectAgentActivity(
  agent: Agent, activityAvailable: boolean,
  snapshot: CollaborationSnapshot | null, modelUnavailable: boolean,
): AgentActivityView {
  const matches: AgentActivityEvent[] = snapshot?.features.flatMap(feature =>
    (feature.observation?.items ?? [])
      .filter(item => item.agentId === agent.id && item.status !== 'idle')
      .map(item => ({ feature: feature.id, item }))) ?? [];
  matches.sort((a, b) => (b.item.updatedAt ?? '').localeCompare(a.item.updatedAt ?? ''));
  const surfaceFeatures = agent.activeSurfaces?.map(surface =>
    surface === 'conversation' ? 'monsoon' : surface);
  const active = matches.find(match => ACTIVE.has(match.item.status)
    && (!surfaceFeatures?.length || surfaceFeatures.includes(match.feature)));
  const recent = matches[0]?.item;
  const recentFeature = matches[0]?.feature;
  const complete = activityAvailable && !!snapshot
    && snapshot.completeness === 'complete'
    && snapshot.features.every(feature => !feature.observationFailure
      && (!feature.observation || (!feature.observation.truncated
        && feature.observation.completeness === 'complete')));
  const common = { observedAt: snapshot?.observedAt, recent, recentFeature,
    events: matches, complete };
  if (activityAvailable && agent.busy && active) {
    const waiting = active.item.status === 'waiting';
    return { kind: waiting ? 'waiting' : 'running',
      label: waiting ? '等待中' : active.item.status === 'queued' ? '排队中' : '工作中',
      summary: active.item.title,
      source: FEATURE_LABELS[active.feature], ...common,
      feature: active.feature, item: active.item };
  }
  if (activityAvailable && agent.busy) {
    const surface = agent.activeSurfaces?.[0];
    const surfaceName = surface === 'conversation' ? '季风'
      : surface && surface in FEATURE_LABELS ? FEATURE_LABELS[surface as CollaborationFeature]
        : undefined;
    const feature = surface === 'conversation' ? 'monsoon'
      : surface && surface in FEATURE_LABELS ? surface as CollaborationFeature : undefined;
    return { kind: 'running', label: surfaceName ? `工作中 · ${surfaceName}` : '工作中',
      summary: '活动已确认，尚无可关联的运行详情', source: 'Agent 活动状态',
      ...common, feature };
  }
  if (!complete || (active && active.item.status !== 'waiting'))
    return { kind: 'unknown', label: '状态未知',
    summary: '当前无法完整确认执行状态', source: '状态源暂不可用',
    ...common };
  if (modelUnavailable) return { kind: 'offline', label: '模型不可用',
    summary: '当前模型配置不可用', source: '模型配置',
    ...common };
  return { kind: 'idle', label: '空闲', summary: '当前未观察到执行中的事项',
    source: 'Agent 活动状态', ...common };
}

export function featureLabel(feature: CollaborationFeature): string {
  return FEATURE_LABELS[feature];
}
