import { readJson, writeJson } from '../api/storage';

export interface ProviderEntry {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  customHeaders?: Record<string, string>;
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
