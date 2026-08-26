export interface OllamaGenerationDefaults {
  maxOutputTokens: number;
  temperature: number | null;
  topP: number | null;
  reasoningEffort: 'auto' | 'none' | 'low' | 'medium' | 'high';
}

export interface OllamaConfig {
  generationDefaults: OllamaGenerationDefaults;
}

export const DEFAULT_OLLAMA_CONFIG: Readonly<OllamaConfig> = {
  generationDefaults: {
    maxOutputTokens: 2048,
    temperature: null,
    topP: null,
    reasoningEffort: 'auto',
  },
};

export const OLLAMA_CONFIG_LIMITS = {
  maxOutputTokens: { min: 1, max: 1_000_000 },
  temperature: { min: 0, max: 2 },
  topP: { min: 0, max: 1 },
} as const;

const ROOT_FIELDS = ['generationDefaults'] as const;
const GENERATION_FIELDS = [
  'maxOutputTokens', 'temperature', 'topP', 'reasoningEffort',
] as const;

export function normalizeOllamaConfig(input: unknown): OllamaConfig {
  const root = record(input, 'Ollama');
  rejectUnknown(root, ROOT_FIELDS, '');
  const generation = nestedRecord(root.generationDefaults, 'generationDefaults');
  rejectUnknown(generation, GENERATION_FIELDS, 'generationDefaults.');
  return { generationDefaults: normalizeGenerationDefaults(generation) };
}

function normalizeGenerationDefaults(value: Record<string, unknown>): OllamaGenerationDefaults {
  const limits = OLLAMA_CONFIG_LIMITS;
  return {
    maxOutputTokens: integer(
      value.maxOutputTokens ?? 2048, 'generationDefaults.maxOutputTokens',
      limits.maxOutputTokens.min, limits.maxOutputTokens.max,
    ),
    temperature: nullableNumber(
      value.temperature, 'generationDefaults.temperature',
      limits.temperature.min, limits.temperature.max,
    ),
    topP: nullableNumber(
      value.topP, 'generationDefaults.topP', limits.topP.min, limits.topP.max,
    ),
    reasoningEffort: reasoningEffort(value.reasoningEffort),
  };
}

function reasoningEffort(value: unknown): OllamaGenerationDefaults['reasoningEffort'] {
  if (value === undefined) return 'auto';
  if (value === 'auto' || value === 'none' || value === 'low'
    || value === 'medium' || value === 'high') return value;
  throw new Error('Ollama generationDefaults.reasoningEffort 必须是 auto、none、low、medium 或 high');
}

function integer(value: unknown, path: string, min: number, max: number): number {
  if (!Number.isInteger(value)) throw new Error(`Ollama ${path} 必须是整数`);
  return ranged(value as number, path, min, max);
}

function nullableNumber(value: unknown, path: string, min: number, max: number): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Ollama ${path} 必须是数字或 null`);
  }
  return ranged(value, path, min, max);
}

function ranged(value: number, path: string, min: number, max: number): number {
  if (value < min || value > max) throw new Error(`Ollama ${path} 必须在 ${min} 到 ${max} 之间`);
  return value;
}

function nestedRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined) return {};
  return record(value, path);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Ollama ${path} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(
  value: Record<string, unknown>, allowed: readonly string[], prefix: string,
): void {
  const unknown = Object.keys(value).find(key => !allowed.includes(key));
  if (unknown) throw new Error(`未知 Ollama 配置字段：${prefix}${unknown}`);
}
