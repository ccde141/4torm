export interface DashScopeGenerationDefaults {
  maxOutputTokens: number;
  temperature: number | null;
  topP: number | null;
  thinkingMode: 'auto' | 'enabled' | 'disabled';
  thinkingBudgetTokens: number | null;
}

export interface DashScopeConfig { generationDefaults: DashScopeGenerationDefaults }

export const DEFAULT_DASHSCOPE_CONFIG: Readonly<DashScopeConfig> = {
  generationDefaults: {
    maxOutputTokens: 8192,
    temperature: null,
    topP: null,
    thinkingMode: 'auto',
    thinkingBudgetTokens: null,
  },
};

export const DASHSCOPE_CONFIG_LIMITS = {
  maxOutputTokens: { min: 1, max: 1_000_000 },
  temperature: { min: 0, max: 1.99 },
  topP: { min: 0.01, max: 1 },
  thinkingBudgetTokens: { min: 1, max: 262_144 },
} as const;

const FIELDS = [
  'maxOutputTokens', 'temperature', 'topP', 'thinkingMode', 'thinkingBudgetTokens',
] as const;

export function normalizeDashScopeConfig(input: unknown): DashScopeConfig {
  const root = record(input, '百炼');
  rejectUnknown(root, ['generationDefaults'], '');
  const generation = record(root.generationDefaults, 'generationDefaults');
  rejectUnknown(generation, FIELDS, 'generationDefaults.');
  return { generationDefaults: {
    maxOutputTokens: integer(generation.maxOutputTokens ?? 8192, 'maxOutputTokens'),
    temperature: nullableNumber(generation.temperature, 'temperature'),
    topP: nullableNumber(generation.topP, 'topP'),
    thinkingMode: choice(generation.thinkingMode, 'thinkingMode', ['auto', 'enabled', 'disabled']),
    thinkingBudgetTokens: nullableInteger(generation.thinkingBudgetTokens, 'thinkingBudgetTokens'),
  } };
}

function integer(value: unknown, name: 'maxOutputTokens' | 'thinkingBudgetTokens'): number {
  if (!Number.isInteger(value)) throw new Error(`百炼 generationDefaults.${name} 必须是整数`);
  return ranged(value as number, name);
}

function nullableInteger(value: unknown, name: 'thinkingBudgetTokens'): number | null {
  if (value === undefined || value === null) return null;
  return integer(value, name);
}

function nullableNumber(value: unknown, name: 'temperature' | 'topP'): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`百炼 generationDefaults.${name} 必须是数字或 null`);
  }
  return ranged(value, name);
}

function ranged(value: number, name: keyof typeof DASHSCOPE_CONFIG_LIMITS): number {
  const range = DASHSCOPE_CONFIG_LIMITS[name];
  if (value < range.min || value > range.max) {
    throw new Error(`百炼 generationDefaults.${name} 必须在 ${range.min} 到 ${range.max} 之间`);
  }
  return value;
}

function choice<T extends string>(value: unknown, name: string, allowed: readonly T[]): T {
  if (value === undefined) return allowed[0]!;
  if (typeof value === 'string' && allowed.includes(value as T)) return value as T;
  throw new Error(`百炼 generationDefaults.${name} 必须是 ${allowed.join('、')}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`百炼 ${path} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[], prefix: string): void {
  const unknown = Object.keys(value).find(key => !allowed.includes(key));
  if (unknown) throw new Error(`未知百炼配置字段：${prefix}${unknown}`);
}
