export interface KimiGenerationDefaults {
  maxOutputTokens: number;
  thinkingMode: 'auto' | 'enabled' | 'disabled';
  reasoningEffort: 'auto' | 'low' | 'high' | 'max';
}

export interface KimiConfig {
  generationDefaults: KimiGenerationDefaults;
}

export const DEFAULT_KIMI_CONFIG: Readonly<KimiConfig> = {
  generationDefaults: {
    maxOutputTokens: 8192,
    thinkingMode: 'auto',
    reasoningEffort: 'auto',
  },
};

export const KIMI_CONFIG_LIMITS = {
  maxOutputTokens: { min: 1, max: 1_000_000 },
} as const;

const GENERATION_FIELDS = ['maxOutputTokens', 'thinkingMode', 'reasoningEffort'] as const;

export function normalizeKimiConfig(input: unknown): KimiConfig {
  const root = record(input, 'Kimi');
  rejectUnknown(root, ['generationDefaults'], '');
  const generation = record(root.generationDefaults, 'generationDefaults');
  rejectUnknown(generation, GENERATION_FIELDS, 'generationDefaults.');
  return { generationDefaults: normalizeGeneration(generation) };
}

function normalizeGeneration(value: Record<string, unknown>): KimiGenerationDefaults {
  return {
    maxOutputTokens: integer(value.maxOutputTokens ?? 8192),
    thinkingMode: choice(value.thinkingMode, 'thinkingMode', ['auto', 'enabled', 'disabled']),
    reasoningEffort: choice(value.reasoningEffort, 'reasoningEffort', ['auto', 'low', 'high', 'max']),
  };
}

function integer(value: unknown): number {
  const { min, max } = KIMI_CONFIG_LIMITS.maxOutputTokens;
  if (!Number.isInteger(value)) throw new Error('Kimi generationDefaults.maxOutputTokens 必须是整数');
  if ((value as number) < min || (value as number) > max) {
    throw new Error(`Kimi generationDefaults.maxOutputTokens 必须在 ${min} 到 ${max} 之间`);
  }
  return value as number;
}

function choice<T extends string>(value: unknown, name: string, allowed: readonly T[]): T {
  if (value === undefined) return allowed[0]!;
  if (typeof value === 'string' && allowed.includes(value as T)) return value as T;
  throw new Error(`Kimi generationDefaults.${name} 必须是 ${allowed.join('、')}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Kimi ${path} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[], prefix: string): void {
  const unknown = Object.keys(value).find(key => !allowed.includes(key));
  if (unknown) throw new Error(`未知 Kimi 配置字段：${prefix}${unknown}`);
}
