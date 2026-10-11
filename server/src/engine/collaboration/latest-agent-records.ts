import { frameworkError } from '../shared/framework-error.js';
import { COLLABORATION_FEATURES, type CollaborationContext,
  type CollaborationFeature, type FeatureModule,
  type OperationRecordSummary } from './contracts.js';
import { validateSummary } from './record-router.js';
import { assertPermission } from './router-guards.js';

export interface LatestRecord {
  agentId: string;
  feature: CollaborationFeature;
  record: OperationRecordSummary;
}

export async function latestAgentRecords(
  modules: ReadonlyMap<CollaborationFeature, FeatureModule>, agentIds: string[],
  context: CollaborationContext,
): Promise<{ items: LatestRecord[]; failures: CollaborationFeature[] }> {
  if (!Array.isArray(agentIds) || agentIds.length > 100
    || agentIds.some(id => typeof id !== 'string'
      || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(id))) throw frameworkError({
    code: 'RECORD_AGENT_INPUT_INVALID', kind: 'validation',
    message: 'Agent 记录索引参数无效', source: 'collaboration.records', retryable: false,
  });
  const wanted = new Set(agentIds);
  const features = COLLABORATION_FEATURES.filter(feature => context.enabledFeatures.has(feature));
  const settled = await Promise.allSettled(features.map(async feature => {
    assertPermission('observe', context, feature);
    const records = modules.get(feature)?.records;
    if (!records) throw new Error(`功能区 ${feature} 缺少运行记录口`);
    return (await records.list(context)).map(validateSummary);
  }));
  const recent = new Map<string, LatestRecord>();
  const failures: CollaborationFeature[] = [];
  settled.forEach((result, index) => {
    const feature = features[index]!;
    if (result.status === 'rejected') { failures.push(feature); return; }
    for (const record of result.value) {
      const owners = new Set([record.agentId, ...(record.agentIds ?? [])]);
      for (const agentId of owners) {
        if (!agentId || !wanted.has(agentId)) continue;
        const previous = recent.get(agentId);
        if (!previous || record.timestamp > previous.record.timestamp) {
          recent.set(agentId, { agentId, feature, record });
        }
      }
    }
  });
  return { items: [...recent.values()], failures };
}
