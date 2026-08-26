export type VllmReasoningEffort =
  | 'auto' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface VllmGenerationDefaults {
  maxOutputTokens: number;
  temperature: number | null;
  topP: number | null;
  topK: number | null;
  minP: number | null;
  repetitionPenalty: number | null;
  reasoningEffort: VllmReasoningEffort;
}

export interface VllmConfig {
  generationDefaults: VllmGenerationDefaults;
}

export const DEFAULT_VLLM_CONFIG: Readonly<VllmConfig> = {
  generationDefaults: {
    maxOutputTokens: 2048,
    temperature: null,
    topP: null,
    topK: null,
    minP: null,
    repetitionPenalty: null,
    reasoningEffort: 'auto',
  },
};

export const VLLM_CONFIG_LIMITS = {
  maxOutputTokens: { min: 1, max: 1_000_000 },
  temperature: { min: 0, max: 2 },
  topP: { min: 0, max: 1 },
  topK: { min: -1, max: 1_000_000 },
  minP: { min: 0, max: 1 },
  repetitionPenalty: { min: 0.01, max: 10 },
} as const;

const FIELDS = [
  'maxOutputTokens', 'temperature', 'topP', 'topK', 'minP',
  'repetitionPenalty', 'reasoningEffort',
] as const;
const EFFORTS: VllmReasoningEffort[] = [
  'auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
];

export function normalizeVllmConfig(input: unknown): VllmConfig {
  const root = record(input, 'vLLM');
  rejectUnknown(root, ['generationDefaults'], '');
  const generation = record(root.generationDefaults, 'generationDefaults');
  rejectUnknown(generation, FIELDS, 'generationDefaults.');
  const limits = VLLM_CONFIG_LIMITS;
  return { generationDefaults: {
    maxOutputTokens: integer(generation.maxOutputTokens ?? 2048, 'maxOutputTokens', limits.maxOutputTokens),
    temperature: numberOrNull(generation.temperature, 'temperature', limits.temperature),
    topP: numberOrNull(generation.topP, 'topP', limits.topP),
    topK: integerOrNull(generation.topK, 'topK', limits.topK),
    minP: numberOrNull(generation.minP, 'minP', limits.minP),
    repetitionPenalty: numberOrNull(generation.repetitionPenalty, 'repetitionPenalty', limits.repetitionPenalty),
    reasoningEffort: effort(generation.reasoningEffort),
  } };
}

function effort(value: unknown): VllmReasoningEffort {
  if (value === undefined) return 'auto';
  if (typeof value === 'string' && EFFORTS.includes(value as VllmReasoningEffort)) {
    return value as VllmReasoningEffort;
  }
  throw new Error(`vLLM generationDefaults.reasoningEffort 必须是 ${EFFORTS.join('、')}`);
}

function integer(value: unknown, name: string, range: { min: number; max: number }): number {
  if (!Number.isInteger(value)) throw new Error(`vLLM generationDefaults.${name} 必须是整数`);
  return ranged(value as number, name, range);
}

function integerOrNull(value: unknown, name: string, range: { min: number; max: number }): number | null {
  if (value === undefined || value === null) return null;
  return integer(value, name, range);
}

function numberOrNull(value: unknown, name: string, range: { min: number; max: number }): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`vLLM generationDefaults.${name} 必须是数字或 null`);
  }
  return ranged(value, name, range);
}

function ranged(value: number, name: string, range: { min: number; max: number }): number {
  if (value < range.min || value > range.max) {
    throw new Error(`vLLM generationDefaults.${name} 必须在 ${range.min} 到 ${range.max} 之间`);
  }
  return value;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`vLLM ${path} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[], prefix: string): void {
  const unknown = Object.keys(value).find(key => !allowed.includes(key));
  if (unknown) throw new Error(`未知 vLLM 配置字段：${prefix}${unknown}`);
}
