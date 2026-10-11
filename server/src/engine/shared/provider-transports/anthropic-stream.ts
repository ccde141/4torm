import {
  createAnthropicStreamAccumulator,
  type AnthropicResult,
} from './anthropic.js';
import { providerResponseError } from '../provider-request-error.js';
import type { ProviderOutputControl } from '../provider-output-control.js';

export async function parseAnthropicSSEStream(
  response: Response,
  nameMap: Map<string, string>,
  onChunk: (chunk: string) => void,
  onReasoning?: (chunk: string) => void,
  outputControl?: ProviderOutputControl,
): Promise<AnthropicResult> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Anthropic 流式响应没有 body');

  const decoder = new TextDecoder();
  const accumulator = createAnthropicStreamAccumulator(nameMap, onChunk, onReasoning);
  let buffer = '';
  const push = (event: Record<string, any>): boolean => {
    accumulator.push(event);
    return outputControl?.shouldStop?.() ?? false;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const consumed = consumeFrames(buffer, push);
    buffer = consumed.buffer;
    if (consumed.stopped) {
      await reader.cancel();
      return { ...accumulator.finish(), finishReason: 'length' };
    }
  }
  buffer += decoder.decode();
  const consumed = consumeFrames(`${buffer}\n\n`, push);
  const result = accumulator.finish();
  return consumed.stopped ? { ...result, finishReason: 'length' } : result;
}

function consumeFrames(
  buffer: string, push: (event: Record<string, any>) => boolean,
): { buffer: string; stopped: boolean } {
  const frames = buffer.split(/\r?\n\r?\n/);
  const remainder = frames.pop() ?? '';
  for (const frame of frames) {
    const data = frame.split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())
      .join('\n');
    if (!data || data === '[DONE]') continue;
    let parsed: Record<string, any>;
    try { parsed = JSON.parse(data); } catch (error) {
      throw new Error('Anthropic 流式事件不是有效 JSON', { cause: error });
    }
    const responseError = providerResponseError(parsed);
    if (responseError) throw responseError;
    if (push(parsed)) return { buffer: '', stopped: true };
  }
  return { buffer: remainder, stopped: false };
}
