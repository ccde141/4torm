import type { ProviderRuntimeFetch } from '../contracts/provider-adapter.js';

interface RuntimeCredentials {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  customHeaders?: Record<string, string>;
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
    const headers = new Headers(init?.headers);
    for (const [key, value] of Object.entries(provider.customHeaders ?? provider.headers ?? {})) {
      headers.set(key, value);
    }
    if (provider.apiKey) headers.set('Authorization', `Bearer ${provider.apiKey}`);
    // 禁止自动重定向，避免自定义认证头随跳转泄漏给其他服务。
    return fetchImpl(input, { ...init, headers, redirect: 'error' });
  };
}
