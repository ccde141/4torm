import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { providersFile } from '../../services/data-paths.js';
import type { ToolTransportProvider } from './tool-transport-contract.js';
import { PROVIDER_FIELDS, validateProviderPatch } from './provider-validation.js';
import { ProviderConfigurationError, isRecord } from './provider-config-error.js';
import { normalizeDeepSeekConfig } from './deepseek-config.js';
export { ProviderConfigurationError, isRecord } from './provider-config-error.js';

export interface StoredProvider extends ToolTransportProvider {
  label?: string;
  apiKey?: string;
  /** Legacy stored header spelling remains readable by every backend model operation. */
  headers?: Record<string, string>;
  customHeaders?: Record<string, string>;
  models?: string[];
  nativeProbe?: Record<string, { native: boolean; probedAt: string }>;
  toolTransports?: Record<string, { status: string; checkedAt: string; fingerprint: string }>;
  modelCapabilities?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}
interface ProviderDocument {
  providers: StoredProvider[];
  activeModel?: string;
  [key: string]: unknown;
}

const transactions = new Map<string, Promise<unknown>>();

export async function readProviderDocument(dataDir: string): Promise<ProviderDocument> {
  let source: unknown;
  try { source = JSON.parse(await fs.readFile(providersFile(dataDir), 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { providers: [], activeModel: '' };
    throw invalidStore();
  }
  if (!isRecord(source) || !Array.isArray(source.providers)
    || (source.activeModel !== undefined && typeof source.activeModel !== 'string')) throw invalidStore();
  const ids = new Set<string>();
  for (const provider of source.providers) {
    if (!isRecord(provider) || typeof provider.id !== 'string' || !provider.id
      || ids.has(provider.id) || typeof provider.baseUrl !== 'string'
      || (provider.apiKey !== undefined && typeof provider.apiKey !== 'string')
      || (provider.models !== undefined && (!Array.isArray(provider.models)
        || !provider.models.every(item => typeof item === 'string')))
      || ['customHeaders', 'headers'].some(key => provider[key] !== undefined && (!isRecord(provider[key])
        || !Object.values(provider[key]).every(value => typeof value === 'string')))) throw invalidStore();
    ids.add(provider.id);
  }
  return source as unknown as ProviderDocument;
}

/** Credentials stay server-side; blank form values are accompanied by explicit presence metadata. */
export function publicProvider(provider: StoredProvider) {
  // Unknown legacy extensions survive disk updates, but are not an accidental public API.
  const result = Object.fromEntries(Object.entries(provider).filter(([key]) =>
    PROVIDER_FIELDS.has(key) && !['apiKey', 'customHeaders'].includes(key)));
  const customHeaders = provider.customHeaders ?? provider.headers;
  return {
    ...structuredClone(result), id: provider.id, label: provider.label ?? '', baseUrl: provider.baseUrl,
    apiKey: '', hasApiKey: !!provider.apiKey, models: provider.models ?? [],
    ...(customHeaders ? {
      customHeaders: Object.fromEntries(Object.keys(customHeaders).map(key => [key, ''])),
      configuredHeaderNames: Object.keys(customHeaders),
    } : { configuredHeaderNames: [] }),
  };
}

export async function publicConfiguration(dataDir: string) {
  const document = await readProviderDocument(dataDir);
  return { providers: document.providers.map(publicProvider), activeModel: document.activeModel ?? '' };
}

export async function findProvider(dataDir: string, id: string): Promise<StoredProvider> {
  const provider = (await readProviderDocument(dataDir)).providers.find(item => item.id === id);
  if (!provider) throw new ProviderConfigurationError(404, 'PROVIDER_NOT_FOUND', '模型提供商不存在');
  return provider;
}

/** Serialize the entire read/modify/replace transaction, rather than only the final rename. */
export async function mutateProviderDocument<T>(
  dataDir: string, change: (document: ProviderDocument) => T | Promise<T>,
): Promise<T> {
  const file = providersFile(dataDir);
  const previous = transactions.get(file) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    const document = await readProviderDocument(dataDir);
    const result = await change(document);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(document, null, 2), { encoding: 'utf8', mode: 0o600 });
      await fs.rename(temporary, file);
    } catch {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw new ProviderConfigurationError(500, 'PROVIDER_CONFIGURATION_WRITE_FAILED', '模型配置保存失败，原有配置未被清空');
    }
    return result;
  });
  transactions.set(file, current);
  try { return await current; }
  finally { if (transactions.get(file) === current) transactions.delete(file); }
}

export async function drainProviderWrites(): Promise<void> {
  while (transactions.size) await Promise.allSettled([...transactions.values()]);
}

export async function createProvider(dataDir: string, input: unknown) {
  const patch = validateProviderPatch(input, true);
  return mutateProviderDocument(dataDir, document => {
    const provider = applyPatch({ id: `pvd_${randomUUID()}`, label: '', apiKey: '', models: [],
      baseUrl: patch.baseUrl as string }, patch);
    validateDeepSeekWrite(provider, patch);
    document.providers.push(provider);
    return publicProvider(provider);
  });
}

export async function patchProvider(dataDir: string, id: string, input: unknown) {
  const patch = validateProviderPatch(input);
  return mutateProviderDocument(dataDir, document => {
    const index = document.providers.findIndex(item => item.id === id);
    if (index < 0) throw new ProviderConfigurationError(404, 'PROVIDER_NOT_FOUND', '模型提供商不存在');
    const updated = applyPatch(document.providers[index], patch);
    validateProviderPatch(updated, true, true);
    validateDeepSeekWrite(updated, patch);
    document.providers[index] = updated;
    return publicProvider(updated);
  });
}

export async function deleteProvider(dataDir: string, id: string) {
  return mutateProviderDocument(dataDir, document => {
    const index = document.providers.findIndex(item => item.id === id);
    if (index < 0) throw new ProviderConfigurationError(404, 'PROVIDER_NOT_FOUND', '模型提供商不存在');
    document.providers.splice(index, 1);
    if (document.activeModel?.startsWith(`${id}:`)) document.activeModel = '';
    return { ok: true };
  });
}

export async function setActiveProviderModel(dataDir: string, input: unknown) {
  if (!isRecord(input) || typeof input.model !== 'string' || Object.keys(input).some(key => key !== 'model')) {
    throw new ProviderConfigurationError(400, 'PROVIDER_CONFIGURATION_INPUT_INVALID', '请选择有效模型');
  }
  const model = input.model;
  return mutateProviderDocument(dataDir, document => {
    if (model && !document.providers.some(provider => (provider.models ?? [])
      .some(item => `${provider.id}:${item}` === model))) {
      throw new ProviderConfigurationError(400, 'PROVIDER_MODEL_NOT_FOUND', '所选模型不存在');
    }
    document.activeModel = model;
    return { activeModel: model };
  });
}

function invalidStore() {
  return new ProviderConfigurationError(500, 'PROVIDER_CONFIGURATION_CORRUPT', '模型配置无法读取，请检查或恢复原配置；未覆盖现有文件');
}

function validateDeepSeekWrite(provider: StoredProvider, patch: Record<string, unknown>): void {
  if (provider.providerType !== 'deepseek'
    || !['generationDefaults', 'providerType'].some(key => Object.hasOwn(patch, key))) return;
  try { normalizeDeepSeekConfig({ generationDefaults: provider.generationDefaults }); }
  catch (cause) {
    throw new ProviderConfigurationError(400, 'PROVIDER_CONFIGURATION_INPUT_INVALID',
      cause instanceof Error ? cause.message : 'DeepSeek 生成配置无效');
  }
}

function applyPatch(provider: StoredProvider, patch: Record<string, unknown>): StoredProvider {
  const updated = { ...provider };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete updated[key];
    else updated[key] = value;
  }
  return updated;
}
