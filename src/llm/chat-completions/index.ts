import { request } from '../client';
import type { RequestOptions } from '../client';
import type { ChatCompletionParams, ChatCompletionResponse } from '../types';

export async function createChatCompletion(
  opts: RequestOptions,
  params: ChatCompletionParams,
): Promise<ChatCompletionResponse> {
  return request<ChatCompletionResponse>('/chat/completions', opts, params);
}

export type { ChatCompletionParams, ChatCompletionResponse };
