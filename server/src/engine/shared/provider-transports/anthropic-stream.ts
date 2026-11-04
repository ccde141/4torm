import {
  createAnthropicStreamAccumulator,
  type AnthropicResult,
} from './anthropic.js';
import { providerResponseError } from '../provider-request-error.js';
import type { ProviderOutputControl } from '../provider-output-control.js';
import type { TokenUsage } from '../llm-bridge.js';
import { createToolProgressTracker, type ToolPreparationProgress } from '../tool-progress.js';
import { assertProviderStreamComplete } from '../provider-stream-completion.js';

export async function parseAnthropicSSEStream(
  response: Response,
  nameMap: Map<string, string>,
  onChunk: (chunk: string) => void,
  onReasoning?: (chunk: string) => void,
  outputControl?: ProviderOutputControl,
  onUsage?: (usage: TokenUsage) => void,
  onToolProgress?: (progress: ToolPreparationProgress) => void,
): Promise<AnthropicResult> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Anthropic 流式响应没有 body');

  const decoder = new TextDecoder();
  const accumulator = createAnthropicStreamAccumulator(nameMap, onChunk, onReasoning);
  const consumer = createEventConsumer(accumulator, nameMap, outputControl, onUsage, onToolProgress);
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const consumed = consumeFrames(buffer, consumer.push);
      buffer = consumed.buffer;
      if (consumed.stopped) return consumer.finish();
    }
    buffer += decoder.decode();
    consumeFrames(`${buffer}\n\n`, consumer.push);
    return consumer.finish();
  } finally {
    try { await reader.cancel(); } catch { /* Preserve the original provider or abort error. */ }
    reader.releaseLock();
  }
}

function createEventConsumer(accumulator: ReturnType<typeof createAnthropicStreamAccumulator>,
  nameMap: Map<string, string>, outputControl?: ProviderOutputControl,
  onUsage?: (usage: TokenUsage) => void, onToolProgress?: (progress: ToolPreparationProgress) => void) {
  let ended = false;
  let limited = false;
  const openBlocks = new Set<number>();
  const progress = createToolProgressTracker({ startedAt: Date.now(), onProgress: onToolProgress,
    restoreName: name => nameMap.get(name) ?? name });
  const push = (event: Record<string, any>): boolean => {
    try { accumulator.push(event); } finally {
      if (event.type === 'message_start' || event.type === 'message_delta') {
        const usage = accumulator.finish().usage;
        if (usage) onUsage?.(usage);
      }
    }
    if (event.type === 'content_block_start') openBlocks.add(event.index ?? 0);
    if (event.type === 'content_block_stop') openBlocks.delete(event.index ?? 0);
    if (event.type === 'message_stop') {
      assertProviderStreamComplete(openBlocks.size === 0 && accumulator.finish().finishReason !== null);
      ended = true;
    }
    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      progress.push([{ index: event.index, function: { name: event.content_block.name } }]);
    } else if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta'
      && event.delta.partial_json) {
      progress.push([{ index: event.index, function: { arguments: event.delta.partial_json } }]);
    }
    limited = outputControl?.shouldStop?.() ?? false;
    return ended || limited;
  };

  return { push, finish(): AnthropicResult {
    assertProviderStreamComplete(ended || limited);
    const result = accumulator.finish();
    return limited && !ended ? { ...result, finishReason: 'length' } : result;
  } };
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
