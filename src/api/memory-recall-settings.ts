import { backendFetch } from '../lib/backend-client';
import { ClientFrameworkError, errorFromResponse } from './error-contract';

export interface MemoryRecallSettings {
  version: 1; model: string | null; enabled?: boolean; embeddingModel?: string | null;
  level1Enabled?: boolean; level2Enabled?: boolean;
  timing?: 'before-send' | 'after-send';
}
export function memoryRecallLevels(settings: MemoryRecallSettings) {
  return { level1Enabled: settings.level1Enabled ?? !!settings.enabled,
    level2Enabled: settings.level2Enabled ?? (!!settings.enabled && !!settings.model) };
}
export interface MemoryRecallVerification { model: string; selectedIds: string[]; elapsedMs: number }

export async function readMemoryRecallSettings(signal?: AbortSignal): Promise<MemoryRecallSettings> {
  return parseSettings(await request('', 'GET', undefined, signal));
}
export async function saveMemoryRecallSettings(settings: MemoryRecallSettings,
  signal?: AbortSignal): Promise<MemoryRecallSettings> {
  return parseSettings(await request('', 'PUT', settings, signal));
}
export async function testMemoryRecallModel(model: string, signal?: AbortSignal): Promise<MemoryRecallVerification> {
  const result = await request('/test-model', 'POST', { model, kind: 'search' }, signal) as Partial<MemoryRecallVerification> | null;
  if (!result || result.model !== model || !Array.isArray(result.selectedIds)
    || !result.selectedIds.every(id => typeof id === 'string')
    || !Number.isFinite(result.elapsedMs) || result.elapsedMs! < 0) return invalidResponse();
  return result as MemoryRecallVerification;
}
export async function testMemoryRecallEmbedding(model: string, signal?: AbortSignal): Promise<{ dimensions: number; elapsedMs: number }> {
  const result = await request('/test-model', 'POST', { model, kind: 'embedding' }, signal) as Record<string, unknown> | null;
  if (!result || result.model !== model || !Number.isSafeInteger(result.dimensions) || Number(result.dimensions) <= 0
    || typeof result.elapsedMs !== 'number' || !Number.isFinite(result.elapsedMs) || result.elapsedMs < 0) return invalidResponse();
  return { dimensions: Number(result.dimensions), elapsedMs: result.elapsedMs };
}
function parseSettings(value: unknown): MemoryRecallSettings {
  const settings = value as Partial<MemoryRecallSettings> | null;
  if (!settings || settings.version !== 1 || (settings.model !== null
    && (typeof settings.model !== 'string' || !settings.model.trim()))) return invalidResponse();
  if ((settings.timing !== undefined && settings.timing !== 'before-send' && settings.timing !== 'after-send')
    || (settings.enabled !== undefined && typeof settings.enabled !== 'boolean')
    || (settings.level1Enabled !== undefined && typeof settings.level1Enabled !== 'boolean')
    || (settings.level2Enabled !== undefined && typeof settings.level2Enabled !== 'boolean')
    || (settings.embeddingModel !== undefined && settings.embeddingModel !== null
      && (typeof settings.embeddingModel !== 'string' || !settings.embeddingModel.trim()))) return invalidResponse();
  return { version: 1, model: settings.model, ...(settings.enabled !== undefined ? { enabled: settings.enabled } : {}),
    ...(settings.level1Enabled !== undefined ? { level1Enabled: settings.level1Enabled } : {}),
    ...(settings.level2Enabled !== undefined ? { level2Enabled: settings.level2Enabled } : {}),
    ...(settings.timing !== undefined ? { timing: settings.timing } : {}),
    ...(settings.embeddingModel !== undefined ? { embeddingModel: settings.embeddingModel } : {}) };
}
function invalidResponse(): never {
  throw new ClientFrameworkError({ code: 'MEMORY_RECALL_RESPONSE_INVALID', kind: 'protocol', message: '记忆召回响应无效' });
}
async function request(suffix: string, method: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await backendFetch(`/api/settings/memory-recall${suffix}`, { method, signal,
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw await errorFromResponse(response);
  return response.json();
}
