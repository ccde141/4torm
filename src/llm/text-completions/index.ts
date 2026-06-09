import { request } from '../client';
import type { RequestOptions } from '../client';
import type { TextCompletionParams, TextCompletionResponse } from '../types';

export async function createTextCompletion(
  opts: RequestOptions,
  params: TextCompletionParams,
): Promise<TextCompletionResponse> {
  return request<TextCompletionResponse>('/completions', opts, params);
}

export type { TextCompletionParams, TextCompletionResponse };
