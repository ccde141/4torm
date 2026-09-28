import { frameworkError, type FrameworkError } from './framework-error.js';

const SOURCE = 'llm-bridge';

export function providerHttpError(status: number, responseBody: string): FrameworkError {
  if (status === 401) {
    return make('MODEL_AUTH_FAILED', 'permission', `模型服务鉴权失败（HTTP ${status}），请检查 API Key`);
  }
  if (status === 403) {
    return make('MODEL_ACCESS_DENIED', 'permission', `模型服务拒绝访问（HTTP ${status}），请检查账号或模型权限`);
  }
  if (status === 404) {
    return make('MODEL_OR_ENDPOINT_NOT_FOUND', 'not_found', `模型或接口不存在（HTTP ${status}）`);
  }
  if (status === 429) {
    return make('MODEL_RATE_LIMITED', 'provider', `模型服务请求过于频繁（HTTP ${status}）`, true);
  }
  if (status === 400 || status === 422) {
    const detail = safeProviderDetail(responseBody);
    const suffix = detail ? `：${detail}` : '';
    return make('MODEL_REQUEST_REJECTED', 'validation', `模型服务拒绝请求（HTTP ${status}）${suffix}`);
  }
  if (status >= 500) {
    return make(`MODEL_PROVIDER_HTTP_${status}`, 'provider', `模型服务暂时不可用（HTTP ${status}）`, true);
  }
  return make(`MODEL_PROVIDER_HTTP_${status}`, 'provider', `模型服务请求失败（HTTP ${status}）`);
}

export function providerNetworkError(error: unknown): FrameworkError {
  const code = networkCauseCode(error);
  const suffix = code ? `（${code}）` : '';
  return make('MODEL_PROVIDER_UNREACHABLE', 'provider', `无法连接模型服务${suffix}`, true, error);
}

function make(
  code: string,
  kind: 'validation' | 'not_found' | 'permission' | 'provider',
  message: string,
  retryable = false,
  cause?: unknown,
): FrameworkError {
  return frameworkError({ code, kind, message, source: SOURCE, retryable }, { cause });
}

function safeProviderDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown };
    const detail = typeof parsed.error === 'object' && parsed.error !== null
      ? parsed.error.message
      : parsed.message ?? parsed.error;
    return typeof detail === 'string' ? sanitize(detail) : '';
  } catch {
    return '';
  }
}

function sanitize(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/Bearer\s+\S+/gi, 'Bearer [已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[已隐藏]')
    .trim()
    .slice(0, 240);
}

function networkCauseCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const cause = (error as { cause?: unknown }).cause;
  if (!cause || typeof cause !== 'object') return '';
  const code = (cause as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : '';
}
