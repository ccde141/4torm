export interface LlamaCppRuntimePolicy {
  contextWindowTokens: number | null;
  maxConcurrency: number | null;
}

export interface LlamaCppGenerationDefaults {
  maxOutputTokens: number;
  temperature: number | null;
  topK: number | null;
  topP: number | null;
  minP: number | null;
  repeatPenalty: number | null;
  thinkingMode: 'auto' | 'enabled' | 'disabled';
  thinkingBudgetTokens: number | null;
}

export interface LlamaCppConfig {
  runtimePolicy: LlamaCppRuntimePolicy;
  generationDefaults: LlamaCppGenerationDefaults;
}

export const DEFAULT_LLAMA_CPP_CONFIG: Readonly<LlamaCppConfig> = {
  runtimePolicy: {
    contextWindowTokens: null,
    maxConcurrency: null,
  },
  generationDefaults: {
    maxOutputTokens: 2048,
    temperature: null,
    topK: null,
    topP: null,
    minP: null,
    repeatPenalty: null,
    thinkingMode: 'auto',
    thinkingBudgetTokens: null,
  },
};

export const LLAMA_CPP_CONFIG_LIMITS = {
  contextWindowTokens: { min: 512, max: 10_000_000 },
  maxConcurrency: { min: 1, max: 1024 },
  maxOutputTokens: { min: 1, max: 1_000_000 },
  temperature: { min: 0, max: 10 },
  topK: { min: 0, max: 1_000_000 },
  topP: { min: 0, max: 1 },
  minP: { min: 0, max: 1 },
  repeatPenalty: { min: 0.01, max: 10 },
  thinkingBudgetTokens: { min: -1, max: 1_000_000 },
} as const;

const ROOT_FIELDS = ['runtimePolicy', 'generationDefaults'] as const;
const RUNTIME_FIELDS = ['contextWindowTokens', 'maxConcurrency'] as const;
const GENERATION_FIELDS = [
  'maxOutputTokens', 'temperature', 'topK', 'topP', 'minP', 'repeatPenalty',
  'thinkingMode', 'thinkingBudgetTokens',
] as const;

export function normalizeLlamaCppConfig(input: unknown): LlamaCppConfig {
  const root = record(input, 'llama.cpp');
  rejectUnknown(root, ROOT_FIELDS, '');
  const runtime = nestedRecord(root.runtimePolicy, 'runtimePolicy');
  const generation = nestedRecord(root.generationDefaults, 'generationDefaults');
  rejectUnknown(runtime, RUNTIME_FIELDS, 'runtimePolicy.');
  rejectUnknown(generation, GENERATION_FIELDS, 'generationDefaults.');
  const result = {
    runtimePolicy: normalizeRuntimePolicy(runtime),
    generationDefaults: normalizeGenerationDefaults(generation),
  };
  validateCombinedBudget(result);
  return result;
}

function normalizeRuntimePolicy(value: Record<string, unknown>): LlamaCppRuntimePolicy {
  const limits = LLAMA_CPP_CONFIG_LIMITS;
  return {
    contextWindowTokens: nullableInteger(
      value.contextWindowTokens, 'runtimePolicy.contextWindowTokens',
      limits.contextWindowTokens.min, limits.contextWindowTokens.max,
    ),
    maxConcurrency: nullableInteger(
      value.maxConcurrency, 'runtimePolicy.maxConcurrency',
      limits.maxConcurrency.min, limits.maxConcurrency.max,
    ),
  };
}

function normalizeGenerationDefaults(value: Record<string, unknown>): LlamaCppGenerationDefaults {
  const limits = LLAMA_CPP_CONFIG_LIMITS;
  return {
    maxOutputTokens: integer(value.maxOutputTokens ?? 2048, 'generationDefaults.maxOutputTokens', limits.maxOutputTokens.min, limits.maxOutputTokens.max),
    temperature: nullableNumber(value.temperature, 'generationDefaults.temperature', limits.temperature.min, limits.temperature.max),
    topK: nullableInteger(value.topK, 'generationDefaults.topK', limits.topK.min, limits.topK.max),
    topP: nullableNumber(value.topP, 'generationDefaults.topP', limits.topP.min, limits.topP.max),
    minP: nullableNumber(value.minP, 'generationDefaults.minP', limits.minP.min, limits.minP.max),
    repeatPenalty: nullableNumber(value.repeatPenalty, 'generationDefaults.repeatPenalty', limits.repeatPenalty.min, limits.repeatPenalty.max),
    thinkingMode: normalizeThinkingMode(value.thinkingMode),
    thinkingBudgetTokens: nullableInteger(
      value.thinkingBudgetTokens, 'generationDefaults.thinkingBudgetTokens',
      limits.thinkingBudgetTokens.min, limits.thinkingBudgetTokens.max,
    ),
  };
}

function normalizeThinkingMode(value: unknown): LlamaCppGenerationDefaults['thinkingMode'] {
  if (value === undefined) return 'auto';
  if (value === 'auto' || value === 'enabled' || value === 'disabled') return value;
  throw new Error('llama.cpp generationDefaults.thinkingMode 必须是 auto、enabled 或 disabled');
}

function validateCombinedBudget(config: LlamaCppConfig): void {
  const context = config.runtimePolicy.contextWindowTokens;
  if (context !== null && config.generationDefaults.maxOutputTokens >= context) {
    throw new Error('llama.cpp generationDefaults.maxOutputTokens 必须小于 runtimePolicy.contextWindowTokens');
  }
}

function nullableInteger(value: unknown, path: string, min: number, max: number): number | null {
  if (value === undefined || value === null) return null;
  return integer(value, path, min, max);
}

function integer(value: unknown, path: string, min: number, max: number): number {
  if (!Number.isInteger(value)) throw new Error(`llama.cpp ${path} 必须是整数`);
  return ranged(value as number, path, min, max);
}

function nullableNumber(value: unknown, path: string, min: number, max: number): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`llama.cpp ${path} 必须是数字或 null`);
  }
  return ranged(value, path, min, max);
}

function ranged(value: number, path: string, min: number, max: number): number {
  if (value < min || value > max) throw new Error(`llama.cpp ${path} 必须在 ${min} 到 ${max} 之间`);
  return value;
}

function nestedRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined) return {};
  return record(value, path);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`llama.cpp ${path} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(
  value: Record<string, unknown>, allowed: readonly string[], prefix: string,
): void {
  const unknown = Object.keys(value).find(key => !allowed.includes(key));
  if (unknown) throw new Error(`未知 llama.cpp 配置字段：${prefix}${unknown}`);
}
