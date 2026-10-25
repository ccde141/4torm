import { modelRuntimeRequest } from './runtime-client';
import type { ProviderProfileId } from './provider-profiles';
import type { ProviderProtocol } from './provider-protocol';
import {
  readModelCapability,
  type ModelCapabilityMap,
  type ToolTransportMap,
} from './model-capabilities';

export interface ProviderEntry {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  /** Credentials are write-only; the backend returns an empty value plus this flag. */
  hasApiKey?: boolean;
  configuredHeaderNames?: string[];
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
  /** 旧版工具模式字段；运行时只根据当前模型的有效探测结果选择。 */
  nativeMode?: 'auto' | 'native' | 'text';
  /** 旧版探测记录，仅供读取兼容；运行时使用带指纹的 toolTransports。 */
  nativeProbe?: Record<string, { native: boolean; probedAt: string }>;
  /** Per-model capability analysis. nativeProbe remains readable for compatibility. */
  modelCapabilities?: ModelCapabilityMap;
  toolTransports?: ToolTransportMap;
  modelProfiles?: Record<string, ProviderProfileId>;
  modelResponseWaitMinutes?: Record<string, number>;
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

interface ProviderConfiguration { providers: ProviderEntry[]; activeModel: string }
let cache: ProviderConfiguration | null = null;
let loading: Promise<ProviderConfiguration> | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();
let generation = 0;

async function load(): Promise<ProviderConfiguration> {
  if (cache) return cache;
  if (!loading) {
    const started = generation;
    const pending = modelRuntimeRequest<ProviderConfiguration>('/configuration').then(value => {
      if (started === generation) cache = value;
      return value;
    }).finally(() => { if (loading === pending) loading = null; });
    loading = pending;
  }
  return loading;
}

/** Preserve edit order without resending a stale copy of other providers or secrets. */
function mutate<T>(path: string, method: string, body?: unknown): Promise<T> {
  const operation = writeQueue.catch(() => undefined).then(async () => {
    const result = await modelRuntimeRequest<T>(path, method, body);
    invalidateCache();
    return result;
  });
  writeQueue = operation;
  return operation;
}

export async function getProviders(): Promise<ProviderEntry[]> {
  return (await load()).providers;
}

export async function addProvider(
  label: string, baseUrl: string, apiKey: string, protocol?: ProviderProtocol,
  selection?: Pick<ProviderEntry, 'providerType' | 'transport' | 'runtimePolicy' | 'generationDefaults'>,
): Promise<ProviderEntry> {
  return mutate('/configuration/providers', 'POST', { label, baseUrl, apiKey, models: [], protocol, ...selection });
}

export async function updateProvider(id: string, patch: Partial<Omit<ProviderEntry, 'id'>>) {
  // JSON omits undefined; explicit null resets optional provider defaults on the server.
  const payload = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value === undefined ? null : value]));
  await mutate(`/configuration/providers/${encodeURIComponent(id)}`, 'PATCH', payload);
}

export async function removeProvider(id: string) {
  await mutate(`/configuration/providers/${encodeURIComponent(id)}`, 'DELETE');
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
  await mutate('/configuration/active-model', 'PUT', { model: key });
}

export function invalidateCache() { generation++; cache = null; loading = null; }

/** A click immediately after a field blur must test the value just submitted. */
export async function flushProviderChanges(): Promise<void> { await writeQueue; }

/** Probes run beside inference on the backend, using server-owned credentials. */
export async function probeAndStore(providerId: string, model: string): Promise<{
  reachable: boolean; native: boolean;
  status: 'unknown' | 'native-confirmed' | 'text-required'; error?: string;
}> {
  await flushProviderChanges();
  const result = await modelRuntimeRequest<{
    reachable: boolean; native: boolean;
    status: 'unknown' | 'native-confirmed' | 'text-required'; error?: string;
  }>('/probes', 'POST', { providerId, model, capability: 'tools' });
  invalidateCache();
  return result;
}

export async function probeVisionAndStore(providerId: string, model: string): Promise<{
  status: 'supported' | 'unsupported' | 'inconclusive'; error?: string;
}> {
  await flushProviderChanges();
  const result = await modelRuntimeRequest<{
    status: 'supported' | 'unsupported' | 'inconclusive'; error?: string;
  }>('/probes', 'POST', { providerId, model, capability: 'vision' });
  invalidateCache();
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
