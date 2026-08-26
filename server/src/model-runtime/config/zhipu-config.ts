export interface ZhipuGenerationDefaults {
  maxOutputTokens: number;
  temperature: number | null;
  topP: number | null;
  thinkingMode: 'auto' | 'enabled' | 'disabled';
  reasoningEffort: 'auto' | 'low' | 'high' | 'max';
}

export interface ZhipuConfig { generationDefaults: ZhipuGenerationDefaults }

export const DEFAULT_ZHIPU_CONFIG: Readonly<ZhipuConfig> = {
  generationDefaults: {
    maxOutputTokens: 8192,
    temperature: null,
    topP: null,
    thinkingMode: 'auto',
    reasoningEffort: 'auto',
  },
};

export const ZHIPU_CONFIG_LIMITS = {
  maxOutputTokens: { min: 1, max: 131_072 },
  temperature: { min: 0.01, max: 1 },
  topP: { min: 0.01, max: 1 },
} as const;

const FIELDS = ['maxOutputTokens', 'temperature', 'topP', 'thinkingMode', 'reasoningEffort'] as const;

export function normalizeZhipuConfig(input: unknown): ZhipuConfig {
  const root = record(input, '智谱');
  rejectUnknown(root, ['generationDefaults'], '');
  const generation = record(root.generationDefaults, 'generationDefaults');
  rejectUnknown(generation, FIELDS, 'generationDefaults.');
  return { generationDefaults: {
    maxOutputTokens: integer(generation.maxOutputTokens ?? 8192, 'maxOutputTokens'),
    temperature: nullableNumber(generation.temperature, 'temperature'),
    topP: nullableNumber(generation.topP, 'topP'),
    thinkingMode: choice(generation.thinkingMode, 'thinkingMode', ['auto', 'enabled', 'disabled']),
    reasoningEffort: choice(generation.reasoningEffort, 'reasoningEffort', ['auto', 'low', 'high', 'max']),
  } };
}

function integer(value: unknown, name: keyof typeof ZHIPU_CONFIG_LIMITS): number {
  if (!Number.isInteger(value)) throw new Error(`智谱 generationDefaults.${name} 必须是整数`);
  return ranged(value as number, name);
}

function nullableNumber(value: unknown, name: 'temperature' | 'topP'): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`智谱 generationDefaults.${name} 必须是数字或 null`);
  }
  return ranged(value, name);
}

function ranged(value: number, name: keyof typeof ZHIPU_CONFIG_LIMITS): number {
  const range = ZHIPU_CONFIG_LIMITS[name];
  if (value < range.min || value > range.max) {
    throw new Error(`智谱 generationDefaults.${name} 必须在 ${range.min} 到 ${range.max} 之间`);
  }
  return value;
}

function choice<T extends string>(value: unknown, name: string, allowed: readonly T[]): T {
  if (value === undefined) return allowed[0]!;
  if (typeof value === 'string' && allowed.includes(value as T)) return value as T;
  throw new Error(`智谱 generationDefaults.${name} 必须是 ${allowed.join('、')}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`智谱 ${path} 必须是对象`);
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[], prefix: string): void {
  const unknown = Object.keys(value).find(key => !allowed.includes(key));
  if (unknown) throw new Error(`未知智谱配置字段：${prefix}${unknown}`);
}
