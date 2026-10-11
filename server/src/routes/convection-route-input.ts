import { frameworkError } from '../engine/shared/framework-error.js';

export function routeText(
  source: unknown,
  key: string,
  required = true,
): string | undefined {
  const value = routeRecord(source)[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!required && value === undefined) return undefined;
  throw invalidRouteInput(key);
}

export function routeRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw invalidRouteInput('body');
}

function invalidRouteInput(field: string) {
  return frameworkError({
    code: 'CONVECTION_HTTP_INPUT_INVALID', kind: 'validation',
    message: `对流请求参数无效：${field}`,
    source: 'http.convection', retryable: false,
  });
}
