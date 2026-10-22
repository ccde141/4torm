export interface DeepSeekGenerationDefaults {
  maxOutputTokens: number;
  temperature: number | null;
  topP: number | null;
  thinkingMode: 'auto' | 'enabled' | 'disabled';
  reasoningEffort: 'auto' | 'low' | 'high' | 'max';
}

export interface DeepSeekConfig {
  generationDefaults: DeepSeekGenerationDefaults;
}

export const DEFAULT_DEEPSEEK_CONFIG: Readonly<DeepSeekConfig> = {
  generationDefaults: {
    maxOutputTokens: 8192,
    temperature: null,
    topP: null,
    thinkingMode: 'auto',
    reasoningEffort: 'auto',
  },
};

export const DEEPSEEK_CONFIG_LIMITS = {
  maxOutputTokens: { min: 1, max: 393_216 },
  temperature: { min: 0, max: 2 },
  topP: { min: 0, max: 1 },
} as const;

const GENERATION_FIELDS = [
  'maxOutputTokens', 'temperature', 'topP', 'thinkingMode', 'reasoningEffort',
] as const;

export function normalizeDeepSeekConfig(input: unknown): DeepSeekConfig {
  const root = record(input, 'DeepSeek');
  rejectUnknown(root, ['generationDefaults'], '');
  const generation = record(root.generationDefaults, 'generationDefaults');
  rejectUnknown(generation, GENERATION_FIELDS, 'generationDefaults.');
  return { generationDefaults: normalizeGeneration(generation) };
}

/** Older configurations accepted a larger cap; constrain it for execution without rewriting storage. */
export function normalizeDeepSeekRuntimeConfig(input: unknown): DeepSeekConfig {
  const root = record(input, 'DeepSeek');
  const generation = record(root.generationDefaults, 'generationDefaults');
  const output = generation.maxOutputTokens;
  return normalizeDeepSeekConfig({
    ...root,
    generationDefaults: {
      ...generation,
      ...(typeof output === 'number' && Number.isSafeInteger(output)
        && output > DEEPSEEK_CONFIG_LIMITS.maxOutputTokens.max
        ? { maxOutputTokens: DEEPSEEK_CONFIG_LIMITS.maxOutputTokens.max } : {}),
    },
  });
}

function normalizeGeneration(value: Record<string, unknown>): DeepSeekGenerationDefaults {
  const limits = DEEPSEEK_CONFIG_LIMITS;
  return {
    maxOutputTokens: integer(value.maxOutputTokens ?? 8192, 'maxOutputTokens', limits.maxOutputTokens),
    temperature: nullableNumber(value.temperature, 'temperature', limits.temperature),
    topP: nullableNumber(value.topP, 'topP', limits.topP),
    thinkingMode: choice(value.thinkingMode, 'thinkingMode', ['auto', 'enabled', 'disabled']),
    reasoningEffort: choice(value.reasoningEffort, 'reasoningEffort', ['auto', 'low', 'high', 'max']),
  };
}

function integer(value: unknown, name: string, range: { min: number; max: number }): number {
  if (!Number.isInteger(value)) throw new Error(`DeepSeek generationDefaults.${name} 必须是整数`);
  return ranged(value as number, name, range);
}

function nullableNumber(value: unknown, name: string, range: { min: number; max: number }): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`DeepSeek generationDefaults.${name} 必须是数字或 null`);
  }
  return ranged(value, name, range);
}

function ranged(value: number, name: string, range: { min: number; max: number }): number {
  if (value < range.min || value > range.max) {
    throw new Error(`DeepSeek generationDefaults.${name} 必须在 ${range.min} 到 ${range.max} 之间`);
  }
  return value;
}

function choice<T extends string>(value: unknown, name: string, allowed: readonly T[]): T {
  if (value === undefined) return allowed[0]!;
  if (typeof value === 'string' && allowed.includes(value as T)) return value as T;
  throw new Error(`DeepSeek generationDefaults.${name} 必须是 ${allowed.join('、')}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`DeepSeek ${path} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[], prefix: string): void {
  const unknown = Object.keys(value).find(key => !allowed.includes(key));
  if (unknown) throw new Error(`未知 DeepSeek 配置字段：${prefix}${unknown}`);
}
