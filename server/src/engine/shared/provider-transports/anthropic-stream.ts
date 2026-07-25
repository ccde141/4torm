import {
  createAnthropicStreamAccumulator,
  type AnthropicResult,
} from './anthropic.js';

export async function parseAnthropicSSEStream(
  response: Response,
  nameMap: Map<string, string>,
  onChunk: (chunk: string) => void,
  onReasoning?: (chunk: string) => void,
): Promise<AnthropicResult> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Anthropic 流式响应没有 body');

  const decoder = new TextDecoder();
  const accumulator = createAnthropicStreamAccumulator(nameMap, onChunk, onReasoning);
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = consumeFrames(buffer, accumulator.push);
  }
  buffer += decoder.decode();
  consumeFrames(`${buffer}\n\n`, accumulator.push);
  return accumulator.finish();
}

function consumeFrames(buffer: string, push: (event: Record<string, any>) => void): string {
  const frames = buffer.split(/\r?\n\r?\n/);
  const remainder = frames.pop() ?? '';
  for (const frame of frames) {
    const data = frame.split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())
      .join('\n');
    if (!data || data === '[DONE]') continue;
    try { push(JSON.parse(data)); } catch (error) {
      throw new Error('Anthropic 流式事件不是有效 JSON', { cause: error });
    }
  }
  return remainder;
}
