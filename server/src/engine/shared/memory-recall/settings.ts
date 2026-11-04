import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../atomic-io.js';
import { frameworkError } from '../framework-error.js';
import { readProviderDocument } from '../../../model-runtime/config/provider-store.js';

export interface MemoryRecallSettings {
  version: 1; model: string | null; enabled?: boolean; embeddingModel?: string | null;
  level1Enabled?: boolean; level2Enabled?: boolean;
  timing?: 'before-send' | 'after-send';
}

/** Independent flags supersede the legacy aggregate switch; old saved choices retain their behavior. */
export function recallLevels(settings: MemoryRecallSettings): { level1Enabled: boolean; level2Enabled: boolean } {
  return { level1Enabled: settings.level1Enabled ?? !!settings.enabled,
    level2Enabled: settings.level2Enabled ?? (!!settings.enabled && !!settings.model) };
}

export function parseMemoryRecallSettings(value: unknown): MemoryRecallSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['version', 'model', 'enabled', 'embeddingModel', 'level1Enabled', 'level2Enabled', 'timing'].includes(key)) || input.version !== 1
    || (input.timing !== undefined && input.timing !== 'before-send' && input.timing !== 'after-send')
    || (input.model !== null && (typeof input.model !== 'string'
      || !input.model.trim() || input.model.length > 500))
    || (input.enabled !== undefined && typeof input.enabled !== 'boolean')
    || (input.level1Enabled !== undefined && typeof input.level1Enabled !== 'boolean')
    || (input.level2Enabled !== undefined && typeof input.level2Enabled !== 'boolean')
    || (input.embeddingModel !== undefined && input.embeddingModel !== null
      && (typeof input.embeddingModel !== 'string' || !input.embeddingModel.trim() || input.embeddingModel.length > 500))) return invalid();
  const settings: MemoryRecallSettings = { version: 1, model: typeof input.model === 'string' ? input.model.trim() : null,
    ...(input.enabled !== undefined ? { enabled: input.enabled as boolean } : {}),
    ...(input.level1Enabled !== undefined ? { level1Enabled: input.level1Enabled as boolean } : {}),
    ...(input.level2Enabled !== undefined ? { level2Enabled: input.level2Enabled as boolean } : {}),
    ...(input.timing !== undefined ? { timing: input.timing as MemoryRecallSettings['timing'] } : {}),
    ...(input.embeddingModel !== undefined ? { embeddingModel: typeof input.embeddingModel === 'string' ? input.embeddingModel.trim() : null } : {}) };
  if (settings.level2Enabled && !settings.model) throw frameworkError({ code: 'MEMORY_RECALL_MODEL_NOT_CONFIGURED',
    kind: 'validation', message: '启用二级召回前请选择召回模型', source: 'memory-recall', retryable: false });
  return settings;
}

export async function loadMemoryRecallSettings(dataDir: string): Promise<MemoryRecallSettings> {
  let raw: string;
  try { raw = await fs.readFile(settingsFile(dataDir), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, model: null };
    throw error;
  }
  try { return parseMemoryRecallSettings(JSON.parse(raw)); }
  catch { throw frameworkError({ code: 'MEMORY_RECALL_SETTINGS_CORRUPT', kind: 'io',
    message: '记忆召回设置无法读取，原文件已保留', source: 'memory-recall', retryable: false }); }
}

export async function saveMemoryRecallSettings(dataDir: string, value: unknown): Promise<MemoryRecallSettings> {
  const settings = parseMemoryRecallSettings(value);
  if (settings.model && settings.level2Enabled !== false) await assertRecallModel(dataDir, settings.model);
  if (settings.embeddingModel && settings.level1Enabled !== false) await assertRecallModel(dataDir, settings.embeddingModel);
  await fs.mkdir(dataDir, { recursive: true });
  await atomicWriteFile(settingsFile(dataDir), JSON.stringify(settings, null, 2));
  return settings;
}

/** Validate against the configured catalog, without inference, probes, or provider mutations. */
export async function assertRecallModel(dataDir: string, model: string): Promise<void> {
  const separator = model.indexOf(':');
  const providers = await readProviderDocument(dataDir);
  const provider = providers.providers.find(item => item.id === model.slice(0, separator));
  if (separator < 1 || !provider?.models?.includes(model.slice(separator + 1))) {
    throw frameworkError({ code: 'MEMORY_RECALL_MODEL_UNAVAILABLE', kind: 'validation',
      message: '记忆召回模型不在当前模型列表中，请重新选择', source: 'memory-recall', retryable: false });
  }
}

function settingsFile(dataDir: string): string { return path.join(dataDir, 'memory-recall-settings.json'); }
function invalid(): never {
  throw frameworkError({ code: 'MEMORY_RECALL_SETTINGS_INVALID', kind: 'validation',
    message: '记忆召回设置无效', source: 'memory-recall', retryable: false });
}
