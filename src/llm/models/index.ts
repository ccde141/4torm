import { modelRuntimeRequest } from '../runtime-client';
import { flushProviderChanges } from '../config';
import type { ListModelsResponse } from '../types';
import {
  resolveProviderProtocol,
  type ProviderProtocol,
} from '../provider-protocol';
import { providerBaseUrl } from '../provider-endpoint';

export interface ListModelsOptions {
  providerId?: string;
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  protocol?: ProviderProtocol;
}

function anthropicHeaders(
  apiKey?: string,
  custom?: Record<string, string>,
): Record<string, string> {
  return {
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
    'anthropic-version': '2023-06-01',
    ...custom,
  };
}

export async function listModels(opts: ListModelsOptions): Promise<ListModelsResponse> {
  if (opts.providerId) {
    await flushProviderChanges();
    return modelRuntimeRequest('/models', 'POST', { providerId: opts.providerId }, opts.signal);
  }
  const baseUrl = providerBaseUrl(opts.baseUrl ?? '', '/models');
  const protocol = resolveProviderProtocol(baseUrl, opts.protocol);
  // 模型发现与会话一样由后端访问提供商，避免本地服务依赖浏览器跨域授权。
  return modelRuntimeRequest<ListModelsResponse>('/models', 'POST', {
    baseUrl,
    apiKey: protocol === 'anthropic-messages' ? undefined : opts.apiKey,
    headers: protocol === 'anthropic-messages'
      ? anthropicHeaders(opts.apiKey, opts.headers) : opts.headers,
  }, opts.signal);
}

export type { ListModelsResponse };
