export interface ModelDiscoveryResult {
  data: Array<{ id: string; [key: string]: unknown }>;
  [key: string]: unknown;
}
interface DiscoveryRequest { url: URL; headers: Headers; secrets: string[] }
interface DiscoveryOptions { fetchImpl?: typeof fetch; timeoutMs?: number }

export class ModelDiscoveryError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string,
    readonly upstreamStatus?: number) { super(message); this.name = 'ModelDiscoveryError'; }
}

/** Discovery only: one authenticated GET, without redirects, retries, persistence or inference. */
export async function discoverModels(value: unknown, options: DiscoveryOptions = {}): Promise<ModelDiscoveryResult> {
  const input = parseRequest(value);
  const signal = AbortSignal.timeout(options.timeoutMs ?? 60_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(input.url, {
      method: 'GET', headers: input.headers, redirect: 'manual', signal,
    });
    if (response.status >= 300 && response.status < 400) throw new ModelDiscoveryError(
      502, 'MODEL_DISCOVERY_REDIRECT_REFUSED', '模型列表服务要求重定向，已拒绝转发认证信息', response.status,
    );
    if (!response.ok) throw await upstreamError(response, input.secrets);
    let payload: unknown;
    try { payload = await response.json(); }
    catch (error) { if (signal.aborted) throw error; throw invalidResponse(); }
    if (!record(payload) || !Array.isArray(payload.data) || !payload.data.every(model =>
      record(model) && typeof model.id === 'string' && !!model.id.trim())) throw invalidResponse();
    return { ...payload, data: payload.data.map(model => ({ ...model, id: model.id as string })) };
  } catch (error) {
    if (error instanceof ModelDiscoveryError) throw error;
    if (signal.aborted) throw new ModelDiscoveryError(504, 'MODEL_DISCOVERY_TIMEOUT', '获取模型列表超时，请检查模型服务');
    throw new ModelDiscoveryError(502, 'MODEL_DISCOVERY_UNREACHABLE', '无法连接模型服务，请检查地址和服务状态');
  }
}

function parseRequest(value: unknown): DiscoveryRequest {
  if (!record(value) || Object.keys(value).some(key => !['baseUrl', 'apiKey', 'headers'].includes(key))
    || typeof value.baseUrl !== 'string' || !value.baseUrl.trim() || value.baseUrl.length > 8192
    || (value.apiKey !== undefined && typeof value.apiKey !== 'string')
    || (value.headers !== undefined && !record(value.headers))) throw invalidInput();
  let url: URL;
  const headers = new Headers({ Accept: 'application/json' });
  try {
    url = new URL(value.baseUrl.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw invalidInput();
    const basePath = url.pathname.replace(/\/+$/, '');
    url.pathname = basePath.endsWith('/models') ? basePath : `${basePath}/models`;
    if (value.apiKey) headers.set('Authorization', `Bearer ${value.apiKey}`);
    for (const [key, header] of Object.entries(value.headers ?? {})) {
      if (typeof header !== 'string') throw invalidInput();
      headers.set(key, header);
    }
  } catch { throw invalidInput(); }
  const secrets = [value.apiKey, ...Object.values(value.headers ?? {})]
    .filter((secret): secret is string => typeof secret === 'string' && !!secret);
  return { url, headers, secrets };
}

async function upstreamError(response: Response, secrets: string[]): Promise<ModelDiscoveryError> {
  let detail = '';
  try {
    const body: unknown = await response.json();
    if (record(body)) {
      const message = record(body.error) ? body.error.message : body.error ?? body.message ?? body.detail;
      if (typeof message === 'string') detail = message;
    }
  } catch { /* The upstream HTTP status remains authoritative even with a non-JSON error body. */ }
  for (const secret of [...secrets].sort((left, right) => right.length - left.length)) {
    detail = detail.replaceAll(secret, '[已隐藏]');
  }
  const message = `模型列表请求失败（上游 HTTP ${response.status}）`;
  return new ModelDiscoveryError(response.status, 'MODEL_DISCOVERY_UPSTREAM_FAILED',
    detail ? `${message}：${detail.slice(0, 1000)}` : message, response.status);
}

function invalidInput(): ModelDiscoveryError {
  return new ModelDiscoveryError(400, 'MODEL_DISCOVERY_INPUT_INVALID',
    '模型列表参数无效：请使用不含用户名密码的 HTTP(S) 地址和有效的认证请求头');
}
function invalidResponse(): ModelDiscoveryError {
  return new ModelDiscoveryError(502, 'MODEL_DISCOVERY_RESPONSE_INVALID', '模型服务未返回有效的模型列表');
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
