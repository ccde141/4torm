import { readJson, writeJson } from '../api/storage';

export interface ProviderEntry {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  customHeaders?: Record<string, string>;
  /** 原生工具调用模式：auto=探测决定（默认）, native=强制原生, text=强制文本协议 */
  nativeMode?: 'auto' | 'native' | 'text';
  /** 原生能力探测缓存：model id → 探测结果（auto 模式据此选循环） */
  nativeProbe?: Record<string, { native: boolean; probedAt: string }>;
}

export interface ModelOption {
  key: string;
  label: string;
  providerId: string;
  modelId: string;
}

const FILE = 'providers.json';

export const PROVIDER_PRESETS: { label: string; baseUrl: string }[] = [
  { label: 'LLM Studio', baseUrl: 'http://localhost:1234/v1' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { label: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
  { label: 'vLLM', baseUrl: 'http://localhost:8000/v1' },
];

let cache: { providers: ProviderEntry[]; activeModel: string } | null = null;

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
  await writeJson(FILE, cache);
}

function nextId(): string {
  return `pvd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function getProviders(): Promise<ProviderEntry[]> {
  return (await load()).providers;
}

export async function addProvider(label: string, baseUrl: string, apiKey: string): Promise<ProviderEntry> {
  const data = await load();
  const entry: ProviderEntry = { id: nextId(), label, baseUrl, apiKey, models: [] };
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
export async function probeAndStore(providerId: string, model: string): Promise<{ reachable: boolean; native: boolean }> {
  const { probeNativeCapability } = await import('./native-probe');
  const provider = await getProvider(providerId);
  if (!provider) return { reachable: false, native: false };

  const result = await probeNativeCapability({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    headers: provider.customHeaders,
    model,
  });

  if (result.reachable) {
    const probe = { ...(provider.nativeProbe ?? {}) };
    probe[model] = { native: result.native, probedAt: new Date().toISOString() };
    await updateProvider(providerId, { nativeProbe: probe });
  }
  return result;
}

/** 读取某 model 的探测结论（auto 模式运行时用） */
export async function getNativeProbe(modelKey: string): Promise<{ native: boolean; probedAt: string } | undefined> {
  const [providerId, ...rest] = modelKey.split(':');
  const model = rest.join(':');
  const provider = await getProvider(providerId);
  return provider?.nativeProbe?.[model];
}
