import { readJson, writeJson } from '../api/storage';
import type { ProviderProfileId } from './provider-profiles';
import { resolveProviderProtocol, type ProviderProtocol } from './provider-protocol';
import {
  buildToolTransportFingerprint,
  readModelCapability,
  writeModelCapability,
  type ModelCapabilityMap,
  type ToolTransportMap,
} from './model-capabilities';

export interface ProviderEntry {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  customHeaders?: Record<string, string>;
  /** Stable provider identity. Missing values retain the legacy configuration path. */
  providerType?: string;
  /** Stable wire transport selected from the backend provider catalog. */
  transport?: string;
  /** Provider-owned runtime limits. Persisted in providers.json for manual editing. */
  runtimePolicy?: Record<string, number | string | null>;
  /** Provider-owned generation defaults. Persisted in providers.json for manual editing. */
  generationDefaults?: Record<string, number | string | null>;
  /** User-defined request body values. Runtime validates and merges these after adapter defaults. */
  customRequestParameters?: Record<string, unknown>;
  /** Local form metadata for custom request values; never sent to the model provider. */
  customParameterDefinitions?: ProviderCustomParameterDefinition[];
  /** Provider request and response protocol. Missing values retain legacy OpenAI-compatible behavior. */
  protocol?: ProviderProtocol;
  /** 工具调用模式：auto=探测决定（默认）, native=强制原生, text=JSON 文本工具调用 */
  nativeMode?: 'auto' | 'native' | 'text';
  /** 原生能力探测缓存：model id → 探测结果（auto 模式据此选循环） */
  nativeProbe?: Record<string, { native: boolean; probedAt: string }>;
  /** Per-model capability analysis. nativeProbe remains readable for compatibility. */
  modelCapabilities?: ModelCapabilityMap;
  toolTransports?: ToolTransportMap;
  modelProfiles?: Record<string, ProviderProfileId>;
}

export type ProviderCustomParameterKind = 'string' | 'number' | 'boolean' | 'select' | 'json';

export interface ProviderCustomParameterDefinition {
  id: string;
  path: string;
  label: string;
  kind: ProviderCustomParameterKind;
  options?: string[];
}

export interface ModelOption {
  key: string;
  label: string;
  providerId: string;
  modelId: string;
}

const FILE = 'providers.json';

let cache: { providers: ProviderEntry[]; activeModel: string } | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function resolveApiKey(provider: ProviderEntry): string {
  if (provider.apiKey) return provider.apiKey;
  const envKey = (import.meta as { env?: Record<string, string> }).env?.[`VITE_PROVIDER_KEY_${provider.id}`];
  return envKey || '';
}

async function load(): Promise<{ providers: ProviderEntry[]; activeModel: string }> {
  if (cache) return cache;
  const data = await readJson<{ providers: ProviderEntry[]; activeModel: string }>(FILE);
  cache = data || { providers: [], activeModel: '' };
  for (const p of cache.providers) {
    p.apiKey = resolveApiKey(p);
  }
  return cache;
}

async function save(providers: ProviderEntry[], activeModel: string) {
  cache = { providers, activeModel };
  const snapshot = structuredClone(cache);
  const write = writeQueue.catch(() => undefined).then(() => writeJson(FILE, snapshot));
  writeQueue = write;
  await write;
}

function nextId(): string {
  return `pvd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function getProviders(): Promise<ProviderEntry[]> {
  return (await load()).providers;
}

export async function addProvider(
  label: string,
  baseUrl: string,
  apiKey: string,
  protocol?: ProviderProtocol,
  selection?: Pick<ProviderEntry, 'providerType' | 'transport' | 'runtimePolicy' | 'generationDefaults'>,
): Promise<ProviderEntry> {
  const data = await load();
  const entry: ProviderEntry = {
    id: nextId(), label, baseUrl, apiKey, models: [],
    ...(protocol ? { protocol } : {}),
    ...selection,
  };
  data.providers.push(entry);
  await save(data.providers, data.activeModel);
  return entry;
}

export async function updateProvider(id: string, patch: Partial<Omit<ProviderEntry, 'id'>>) {
  const data = await load();
  const idx = data.providers.findIndex(p => p.id === id);
  if (idx < 0) return;
  data.providers[idx] = { ...data.providers[idx], ...patch };
  await save(data.providers, data.activeModel);
}

export async function removeProvider(id: string) {
  const data = await load();
  await save(data.providers.filter(p => p.id !== id), data.activeModel);
}

export async function getProvider(id: string): Promise<ProviderEntry | undefined> {
  return (await load()).providers.find(p => p.id === id);
}

export async function getProviderForModel(modelKey: string): Promise<ProviderEntry | undefined> {
  const [providerId] = modelKey.split(':');
  return getProvider(providerId);
}

export async function getAllModels(): Promise<ModelOption[]> {
  const data = await load();
  const result: ModelOption[] = [];
  for (const p of data.providers) {
    for (const m of p.models) {
      result.push({ key: `${p.id}:${m}`, label: `${p.label} / ${m}`, providerId: p.id, modelId: m });
    }
  }
  return result;
}

export async function getActiveModel(): Promise<string> {
  return (await load()).activeModel;
}

export async function setActiveModel(key: string) {
  const data = await load();
  await save(data.providers, key);
}

export function invalidateCache() {
  cache = null;
}

/**
 * 探测某 model 的原生能力并落盘到 provider.nativeProbe。
 * 连通失败（reachable=false）不落盘，返回结果供 UI 提示。
 */
export async function probeAndStore(providerId: string, model: string): Promise<{
  reachable: boolean;
  native: boolean;
  status: 'unknown' | 'native-confirmed' | 'text-required';
  error?: string;
}> {
  const { probeNativeCapability } = await import('./native-probe');
  const provider = await getProvider(providerId);
  if (!provider) return { reachable: false, native: false, status: 'unknown' };

  const result = await probeNativeCapability({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    headers: provider.customHeaders,
    model,
    protocol: resolveProviderProtocol(provider.baseUrl, provider.protocol),
    profile: provider.modelProfiles?.[model] ?? 'auto',
  });

  if (result.status !== 'unknown') {
    const checkedAt = new Date().toISOString();
    const protocol = resolveProviderProtocol(provider.baseUrl, provider.protocol);
    const profile = provider.modelProfiles?.[model] ?? 'auto';
    const probe = { ...(provider.nativeProbe ?? {}) };
    probe[model] = { native: result.native, probedAt: checkedAt };
    const toolTransports = { ...(provider.toolTransports ?? {}) };
    toolTransports[model] = {
      status: result.status,
      checkedAt,
      fingerprint: buildToolTransportFingerprint({
        providerId, baseUrl: provider.baseUrl, protocol, model, profile,
      }),
    };
    await updateProvider(providerId, {
      nativeProbe: probe,
      toolTransports,
      modelCapabilities: writeModelCapability(
        provider.modelCapabilities, model, 'tools',
        {
          status: result.native ? 'supported' : 'unsupported',
          checkedAt,
          method: 'auto-tool-v2',
        },
      ),
    });
  }
  return result;
}

export async function probeVisionAndStore(providerId: string, model: string) {
  const { probeVisionCapability } = await import('./vision-probe');
  const provider = await getProvider(providerId);
  if (!provider) return { status: 'inconclusive' as const, error: 'Provider not found' };
  const result = await probeVisionCapability({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    headers: provider.customHeaders,
    model,
    protocol: resolveProviderProtocol(provider.baseUrl, provider.protocol),
  });
  if (result.status !== 'inconclusive') {
    await updateProvider(providerId, {
      modelCapabilities: writeModelCapability(
        provider.modelCapabilities, model, 'vision',
        { status: result.status, checkedAt: new Date().toISOString() },
      ),
    });
  }
  return result;
}

export async function getModelCapability(modelKey: string, capability: 'tools' | 'vision') {
  const [providerId, ...rest] = modelKey.split(':');
  const provider = await getProvider(providerId);
  return provider ? readModelCapability(provider, rest.join(':'), capability) : undefined;
}

/** 读取某 model 的探测结论（auto 模式运行时用） */
export async function getNativeProbe(modelKey: string): Promise<{ native: boolean; probedAt: string } | undefined> {
  const [providerId, ...rest] = modelKey.split(':');
  const model = rest.join(':');
  const provider = await getProvider(providerId);
  return provider?.nativeProbe?.[model];
}
