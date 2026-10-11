import { invokeFeature } from '../../api/collaboration';

export interface AutoProfile {
  id: string;
  name: string;
  cadence: { kind: 'relative'; gapSec: number };
  overlap: 'skip' | 'queue';
  lapBound: number | null;
  carryOver: 'accumulate' | 'reset' | 'summary';
  loopNote?: string;
  summaryPrompt?: string;
}

export async function listProfiles(workflowId: string, fallback = '加载循环档案失败'): Promise<AutoProfile[]> {
  return invokeFeature<AutoProfile[]>('tradewind', 'loadWorkflowProfiles', { workflowId }, fallback);
}

export async function saveProfiles(workflowId: string, profiles: AutoProfile[], fallback = '保存循环档案失败'): Promise<void> {
  await invokeFeature('tradewind', 'saveWorkflowProfiles', { workflowId, profiles }, fallback);
}

export async function deleteProfile(workflowId: string, profileId: string, fallback = '删除循环档案失败'): Promise<void> {
  await invokeFeature('tradewind', 'deleteWorkflowProfile', { workflowId, profileId }, fallback);
}
