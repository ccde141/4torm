const PROTECTED_ROOT_FIELDS = new Set([
  'model', 'messages', 'system', 'stream', 'tools', 'tool_choice',
]);
const UNSAFE_FIELDS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_DEPTH = 12;
const MAX_VALUES = 1_000;

interface ValidationState {
  values: number;
}

export function mergeCustomRequestParameters(
  normalizedBody: Record<string, unknown>,
  customParameters: unknown,
): Record<string, unknown> {
  if (customParameters === undefined || customParameters === null) {
    return structuredClone(normalizedBody);
  }
  if (!isPlainRecord(customParameters)) {
    throw new Error('Provider 自定义请求参数必须是对象');
  }
  for (const key of Object.keys(customParameters)) {
    if (PROTECTED_ROOT_FIELDS.has(key)) {
      throw new Error(`Provider 自定义请求参数不能覆盖核心字段：${key}`);
    }
  }
  validateRecord(customParameters, '', 0, { values: 0 });
  return mergeRecords(normalizedBody, customParameters);
}

function mergeRecords(
  base: Record<string, unknown>,
  custom: Record<string, unknown>,
): Record<string, unknown> {
  const merged = structuredClone(base);
  for (const [key, value] of Object.entries(custom)) {
    const current = merged[key];
    merged[key] = isPlainRecord(current) && isPlainRecord(value)
      ? mergeRecords(current, value)
      : structuredClone(value);
  }
  return merged;
}

function validateRecord(
  value: Record<string, unknown>,
  path: string,
  depth: number,
  state: ValidationState,
): void {
  if (depth > MAX_DEPTH) throw new Error(`Provider 自定义请求参数嵌套超过 ${MAX_DEPTH} 层`);
  for (const [key, child] of Object.entries(value)) {
    if (UNSAFE_FIELDS.has(key)) throw new Error(`Provider 自定义请求参数包含不安全字段：${path}${key}`);
    validateValue(child, `${path}${key}`, depth + 1, state);
  }
}

function validateValue(
  value: unknown,
  path: string,
  depth: number,
  state: ValidationState,
): void {
  state.values += 1;
  if (state.values > MAX_VALUES) throw new Error(`Provider 自定义请求参数超过 ${MAX_VALUES} 个值`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Provider 自定义请求参数 ${path} 必须是有限数字`);
    return;
  }
  if (Array.isArray(value)) {
    if (depth > MAX_DEPTH) throw new Error(`Provider 自定义请求参数嵌套超过 ${MAX_DEPTH} 层`);
    value.forEach((child, index) => validateValue(child, `${path}[${index}]`, depth + 1, state));
    return;
  }
  if (isPlainRecord(value)) {
    validateRecord(value, `${path}.`, depth, state);
    return;
  }
  throw new Error(`Provider 自定义请求参数 ${path} 不是 JSON 值`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
