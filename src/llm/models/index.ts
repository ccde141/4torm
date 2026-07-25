import { request } from '../client';
import type { RequestOptions } from '../client';
import type { ListModelsResponse } from '../types';
import {
  resolveProviderProtocol,
  type ProviderProtocol,
} from '../provider-protocol';
import { providerBaseUrl } from '../provider-endpoint';

export interface ListModelsOptions extends RequestOptions {
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
  const baseUrl = providerBaseUrl(opts.baseUrl, '/models');
  const protocol = resolveProviderProtocol(baseUrl, opts.protocol);
  if (protocol === 'anthropic-messages') {
    return request<ListModelsResponse>('/models', {
      ...opts,
      baseUrl,
      apiKey: undefined,
      headers: anthropicHeaders(opts.apiKey, opts.headers),
    });
  }
  return request<ListModelsResponse>('/models', { ...opts, baseUrl });
}

export type { ListModelsResponse };
