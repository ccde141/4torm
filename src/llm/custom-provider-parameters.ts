import type {
  ProviderCustomParameterDefinition,
  ProviderCustomParameterKind,
} from './config';

const PROTECTED_ROOTS = new Set([
  'model', 'messages', 'system', 'stream', 'tools', 'tool_choice',
]);
const UNSAFE_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const PATH_SEGMENT = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const MAX_PATH_DEPTH = 8;
const PARAMETER_KINDS = new Set<ProviderCustomParameterKind>([
  'string', 'number', 'boolean', 'select', 'json',
]);

type DefinitionDraft = Omit<ProviderCustomParameterDefinition, 'id'> & { id?: string };

export function defineCustomParameter(
  existing: ProviderCustomParameterDefinition[],
  draft: DefinitionDraft,
): ProviderCustomParameterDefinition {
  const path = draft.path.trim();
  const label = draft.label.trim();
  if (!PARAMETER_KINDS.has(draft.kind)) throw new Error(`不支持的自定义字段类型：${draft.kind}`);
  validatePath(path);
  if (!label) throw new Error('自定义字段名称不能为空');
  validatePathConflicts(existing, path);
  const options = normalizeOptions(draft.kind, draft.options);
  const id = draft.id?.trim() || `custom:${path}`;
  if (existing.some(definition => definition.id === id)) throw new Error(`自定义字段标识已存在：${id}`);
  return {
    id,
    path,
    label,
    kind: draft.kind,
    ...(options ? { options } : {}),
  };
}

export function readCustomParameterDefinitions(value: unknown): {
  definitions: ProviderCustomParameterDefinition[];
  invalidCount: number;
} {
  if (value === undefined || value === null) return { definitions: [], invalidCount: 0 };
  if (!Array.isArray(value)) return { definitions: [], invalidCount: 1 };
  const definitions: ProviderCustomParameterDefinition[] = [];
  let invalidCount = 0;
  for (const candidate of value) {
    try {
      if (!isRecord(candidate)) throw new Error('定义必须是对象');
      const definition = defineCustomParameter(definitions, {
        id: typeof candidate.id === 'string' ? candidate.id : undefined,
        path: typeof candidate.path === 'string' ? candidate.path : '',
        label: typeof candidate.label === 'string' ? candidate.label : '',
        kind: candidate.kind as ProviderCustomParameterKind,
        options: Array.isArray(candidate.options)
          ? candidate.options.filter((option): option is string => typeof option === 'string')
          : undefined,
      });
      definitions.push(definition);
    } catch {
      invalidCount += 1;
    }
  }
  return { definitions, invalidCount };
}

export function setCustomParameterFromText(
  source: Record<string, unknown>,
  definition: ProviderCustomParameterDefinition,
  text: string,
): Record<string, unknown> {
  const segments = validatePath(definition.path);
  const value = parseValue(definition.kind, text, definition.options);
  return setNestedValue(source, segments, value);
}

export function removeCustomParameter(
  source: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  const clone = structuredClone(source);
  deleteNestedValue(clone, validatePath(path), 0);
  return clone;
}

export function customParameterText(
  source: Record<string, unknown> | undefined,
  definition: ProviderCustomParameterDefinition,
): string {
  const value = readNestedValue(source ?? {}, validatePath(definition.path));
  if (value === undefined) return '';
  if (definition.kind === 'json') return JSON.stringify(value);
  return String(value);
}

function validatePath(path: string): string[] {
  const segments = path.split('.');
  if (!path || segments.length > MAX_PATH_DEPTH || segments.some(segment => !PATH_SEGMENT.test(segment))) {
    throw new Error(`自定义字段路径无效：${path || '(空)'}`);
  }
  if (PROTECTED_ROOTS.has(segments[0]!)) throw new Error(`不能配置核心字段：${segments[0]}`);
  const unsafe = segments.find(segment => UNSAFE_SEGMENTS.has(segment));
  if (unsafe) throw new Error(`自定义字段路径包含不安全字段：${unsafe}`);
  return segments;
}

function validatePathConflicts(existing: ProviderCustomParameterDefinition[], path: string): void {
  for (const definition of existing) {
    if (definition.path === path) throw new Error(`自定义字段已存在：${path}`);
    if (definition.path.startsWith(`${path}.`) || path.startsWith(`${definition.path}.`)) {
      throw new Error(`自定义字段路径冲突：${path} 与 ${definition.path}`);
    }
  }
}

function normalizeOptions(kind: ProviderCustomParameterKind, options?: string[]): string[] | undefined {
  if (kind !== 'select') return undefined;
  const normalized = [...new Set((options ?? []).map(option => option.trim()).filter(Boolean))];
  if (normalized.length === 0) throw new Error('选择字段至少需要一个可选值');
  return normalized;
}

function parseValue(kind: ProviderCustomParameterKind, text: string, options?: string[]): unknown {
  if (kind === 'string') return text;
  if (kind === 'number') {
    const value = Number(text);
    if (!text.trim() || !Number.isFinite(value)) throw new Error('自定义字段必须是有限数字');
    return value;
  }
  if (kind === 'boolean') {
    if (text !== 'true' && text !== 'false') throw new Error('布尔字段只能是 true 或 false');
    return text === 'true';
  }
  if (kind === 'select') {
    if (!options?.includes(text)) throw new Error('自定义字段不是有效可选值');
    return text;
  }
  try {
    const value = JSON.parse(text) as unknown;
    validateJsonValue(value);
    return value;
  } catch (cause) {
    if (cause instanceof SyntaxError) {
      throw new Error(`自定义字段不是有效 JSON：${cause.message}`, { cause });
    }
    throw cause;
  }
}

function setNestedValue(
  source: Record<string, unknown>,
  segments: string[],
  value: unknown,
): Record<string, unknown> {
  const clone = structuredClone(source);
  let cursor = clone;
  for (const segment of segments.slice(0, -1)) {
    const current = cursor[segment];
    if (current !== undefined && !isRecord(current)) throw new Error(`自定义字段父路径不是对象：${segment}`);
    const next = current === undefined ? {} : current;
    cursor[segment] = next;
    cursor = next as Record<string, unknown>;
  }
  cursor[segments.at(-1)!] = value;
  return clone;
}

function deleteNestedValue(target: Record<string, unknown>, segments: string[], index: number): boolean {
  const key = segments[index]!;
  if (index === segments.length - 1) delete target[key];
  else if (isRecord(target[key]) && deleteNestedValue(target[key], segments, index + 1)) delete target[key];
  return Object.keys(target).length === 0;
}

function readNestedValue(source: Record<string, unknown>, segments: string[]): unknown {
  let value: unknown = source;
  for (const segment of segments) {
    if (!isRecord(value)) return undefined;
    value = value[segment];
  }
  return value;
}

function validateJsonValue(value: unknown): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('JSON 数字必须有限');
    return;
  }
  if (Array.isArray(value)) return value.forEach(validateJsonValue);
  if (!isRecord(value)) throw new Error('自定义字段必须是 JSON 值');
  for (const [key, child] of Object.entries(value)) {
    if (UNSAFE_SEGMENTS.has(key)) throw new Error(`JSON 包含不安全字段：${key}`);
    validateJsonValue(child);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
