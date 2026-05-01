import { request } from '../client';
import type { RequestOptions } from '../client';
import type { ListModelsResponse } from '../types';

export async function listModels(opts: RequestOptions): Promise<ListModelsResponse> {
  return request<ListModelsResponse>('/models', opts);
}

export type { ListModelsResponse };
