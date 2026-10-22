import type { ProviderRuntimeFetch } from '../contracts/provider-adapter.js';
import type { ProviderProtocol } from '../config/tool-transport-contract.js';

interface RuntimeCredentials {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  customHeaders?: Record<string, string>;
}

/** Saved providers use one case-insensitive authentication policy in every backend operation. */
export function providerRequestHeaders(
  provider: Omit<RuntimeCredentials, 'baseUrl'>, protocol: ProviderProtocol, initial?: HeadersInit,
): Headers {
  const headers = new Headers(initial);
  for (const [key, value] of Object.entries(provider.customHeaders ?? provider.headers ?? {})) headers.set(key, value);
  if (protocol === 'anthropic-messages') {
    if (!headers.has('anthropic-version')) headers.set('anthropic-version', '2023-06-01');
    if (provider.apiKey && !headers.has('x-api-key')) headers.set('x-api-key', provider.apiKey);
  } else if (provider.apiKey) headers.set('Authorization', `Bearer ${provider.apiKey}`);
  return headers;
}

/** 认证仅存在于请求闭包，不进入可记录的模型 identity 或探测结果。 */
export function createRuntimeFetch(
  provider: RuntimeCredentials, fetchImpl: ProviderRuntimeFetch = fetch,
): ProviderRuntimeFetch {
  const origin = new URL(provider.baseUrl).origin;
  return async (input, init) => {
    const url = new URL(input);
    if (url.origin !== origin || url.username || url.password) {
      throw new Error('运行能力探测拒绝向不同 origin 或带凭据的 URL 发送请求');
    }
    const headers = providerRequestHeaders(provider, 'openai-chat-completions', init?.headers);
    // 禁止自动重定向，避免自定义认证头随跳转泄漏给其他服务。
    return fetchImpl(input, { ...init, headers, redirect: 'error' });
  };
}
