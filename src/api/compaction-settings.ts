import { backendFetch } from '../lib/backend-client';
import { errorFromResponse } from './error-contract';

export const COMPACTION_AREAS = ['monsoon', 'convection', 'cycloneConversation',
  'cycloneMeeting', 'tradewindConversation', 'tradewindMeeting', 'tide'] as const;
export type CompactionArea = typeof COMPACTION_AREAS[number];
export interface CompactionPolicy {
  version: 1; enabled: boolean; prefixRatio: number; modelMode: 'current' | 'fixed';
  fixedModel: string | null; thresholds: Record<CompactionArea, number>;
}

export async function readCompactionSettings(): Promise<CompactionPolicy> {
  return parsePolicy(await request('/api/settings/compaction'));
}
export async function saveCompactionSettings(policy: CompactionPolicy): Promise<CompactionPolicy> {
  return parsePolicy(await request('/api/settings/compaction', 'PUT', policy));
}
export async function testCompactionModel(model: string): Promise<void> {
  await request('/api/settings/compaction/test-model', 'POST', { model });
}
async function request(url: string, method = 'GET', body?: unknown): Promise<unknown> {
  const response = await backendFetch(url, { method, ...(body !== undefined ? {
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : {}) });
  if (!response.ok) throw await errorFromResponse(response);
  return response.json();
}
function parsePolicy(value: unknown): CompactionPolicy {
  if (!value || typeof value !== 'object') throw new Error('压缩设置响应无效');
  const policy = value as Partial<CompactionPolicy>;
  if (policy.version !== 1 || typeof policy.enabled !== 'boolean'
    || !Number.isFinite(policy.prefixRatio) || !['current', 'fixed'].includes(policy.modelMode ?? '')
    || !policy.thresholds || !COMPACTION_AREAS.every(area =>
      Number.isSafeInteger(policy.thresholds?.[area]))) throw new Error('压缩设置响应无效');
  return policy as CompactionPolicy;
}
