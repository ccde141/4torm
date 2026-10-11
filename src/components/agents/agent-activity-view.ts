import type { CollaborationFeature, CollaborationStatus } from '../../api/collaboration';
import type { AgentActivityEvent, AgentActivityView } from './dashboard-activity';
import { recordTitle } from './agent-card-view';

export function activityIdentity(event: AgentActivityEvent): string {
  return `${event.feature}:${event.item.operationId}:${event.item.runId ?? ''}`;
}

export function activityPreview(activity: AgentActivityView, limit = 2) {
  return activity.events.slice(0, limit).map(event => ({
    ...event, key: activityIdentity(event), title: recordTitle(event.item),
  }));
}

export function activityMetrics(activity: AgentActivityView) {
  const statuses: Partial<Record<CollaborationStatus, number>> = {};
  const features: Partial<Record<CollaborationFeature, number>> = {};
  for (const event of activity.events) {
    statuses[event.item.status] = (statuses[event.item.status] ?? 0) + 1;
    features[event.feature] = (features[event.feature] ?? 0) + 1;
  }
  return {
    visibleItems: activity.events.length,
    statuses, features,
    complete: activity.complete,
    observedAt: activity.observedAt,
  };
}
