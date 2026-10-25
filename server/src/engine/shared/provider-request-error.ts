import { frameworkError, FrameworkError } from './framework-error.js';

const SOURCE = 'llm-bridge';
const CONTEXT_CODES = new Set([
  'context_length_exceeded', 'max_context_length_exceeded', 'context_window_exceeded',
  'prompt_too_long', 'input_tokens_exceeded',
]);

/** Only an explicit input/context-capacity rejection permits compaction recovery. */
export function isProviderContextOverflow(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'data' in error
    && !!error.data && typeof error.data === 'object' && 'code' in error.data
    && error.data.code === 'MODEL_CONTEXT_LIMIT_EXCEEDED';
}

export function providerResponseError(payload: unknown): FrameworkError | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Record<string, unknown>;
  if (!value.error) return null;
  return providerHttpError(422, JSON.stringify(value));
}

export function providerHttpError(status: number, responseBody: string): FrameworkError {
  if ((status === 400 || status === 413 || status === 422) && isContextRejection(responseBody)) {
    return make('MODEL_CONTEXT_LIMIT_EXCEEDED', 'provider',
      `模型服务确认输入超过上下文容量${detailSuffix(responseBody)}`);
  }
  if ((status === 400 || status === 413 || status === 422) && isImageCapacityRejection(responseBody)) {
    return make('MODEL_IMAGE_LIMIT_EXCEEDED', 'validation',
      `模型服务确认图片输入超过限制${detailSuffix(responseBody)}`);
  }
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

function isImageCapacityRejection(body: string): boolean {
  try {
    const parsed = JSON.parse(body);
    const code = parsed?.error?.code ?? parsed?.code;
    if (['too_many_images', 'image_limit_exceeded', 'image_count_exceeded', 'image_size_exceeded', 'image_too_large'].includes(code)) return true;
  } catch { /* Text diagnostics are checked below. */ }
  const detail = safeProviderDetail(body) || body;
  return /too many images|(?:image|images).{0,90}(?:limit|exceed|too (?:large|big)|maximum|max allowed)|(?:maximum|at most|no more than).{0,30}(?:images|image inputs)|(?:图片|图像).{0,50}(?:过多|超出|超过|上限|太大)/i.test(detail)
    && !/invalid (?:image|base64)|unsupported|not support|不支持|格式|编码/i.test(detail);
}

function isContextRejection(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const error = parsed.error && typeof parsed.error === 'object'
      ? parsed.error as Record<string, unknown> : parsed;
    if ([error.code, error.type].some(code => typeof code === 'string'
      && CONTEXT_CODES.has(code.toLowerCase()))) return true;
  } catch { /* Non-JSON provider diagnostics are still matched against explicit capacity language. */ }
  const detail = safeProviderDetail(body) || body;
  return /maximum context length|context (?:length|window).*(?:exceed|too (?:long|large))|(?:exceed|longer than).*(?:context (?:length|window))|prompt is too long|input token(?:s)? (?:limit )?exceeded|输入.*(?:token|令牌).*超|上下文.*(?:超出|超过)/i.test(detail);
}

function detailSuffix(body: string): string {
  const detail = safeProviderDetail(body);
  return detail ? `：${detail}` : '';
}

export function providerNetworkError(error: unknown): FrameworkError {
  const code = networkCauseCode(error);
  const suffix = code ? `（${code}）` : '';
  return make('MODEL_PROVIDER_UNREACHABLE', 'provider', `无法连接模型服务${suffix}`, true, error);
}

/** A body reader can lose its socket after fetch has already returned headers. */
export function providerTransportError(error: unknown): unknown {
  if (error instanceof FrameworkError) return error;
  const code = networkCauseCode(error);
  return /^(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EHOSTUNREACH|ENETUNREACH|UND_ERR_SOCKET|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT)$/.test(code)
    ? providerNetworkError(error) : error;
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
