import type { CollaborationFeature, OperationRecordSummary } from '../../api/collaboration';
import type { AgentActivityEvent, AgentActivityView } from './dashboard-activity';
import { activityIdentity } from './agent-activity-view';

export interface AttributedRecord {
  feature: CollaborationFeature;
  record: OperationRecordSummary;
}

export function mergeAgentRecords(
  activity: AgentActivityView, records: AttributedRecord[],
): AgentActivityView {
  const events = new Map<string, AgentActivityEvent>();
  for (const event of activity.events) events.set(activityIdentity(event), event);
  for (const { feature, record } of records) {
    const event: AgentActivityEvent = { feature, record, item: {
      operationId: record.operationId, runId: record.runId,
      title: record.title, status: record.status,
      updatedAt: record.timestamp, agentId: record.agentId,
    } };
    const key = activityIdentity(event);
    events.set(key, events.has(key) ? { ...events.get(key)!, record } : event);
  }
  return { ...activity, events: [...events.values()].sort((a, b) =>
    (b.item.updatedAt ?? '').localeCompare(a.item.updatedAt ?? '')) };
}

export function recordNavigation(feature: CollaborationFeature,
  record: OperationRecordSummary): {
    page: string; targetId: string; linkedSessionId?: string;
    tideSessionTarget?: string;
  } {
  return {
    page: feature === 'monsoon' ? 'chat' : feature,
    targetId: feature === 'monsoon' || feature === 'convection'
      ? record.sessionId ?? record.operationId : record.operationId,
    ...(record.linkedSessionId ? { linkedSessionId: record.linkedSessionId } : {}),
    ...(feature === 'tide' && record.sessionId && record.agentId
      ? { tideSessionTarget: `session:${record.agentId}:${record.sessionId}` } : {}),
  };
}
