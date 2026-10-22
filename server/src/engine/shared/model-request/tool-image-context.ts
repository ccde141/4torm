import type { ContextMessage, ProviderImage, ToolImageRef } from '../types.js';
import { readToolImage } from '../tool-media-store.js';
import { MAX_MODEL_TOOL_IMAGES } from './tool-image-projection.js';
import { formatTextToolResult, parseTextToolResult } from '../text-tool-protocol.js';

/** Request budget applies to tool screenshots, independently of user attachments. */
const MAX_MODEL_TOOL_IMAGE_BYTES = 12 * 1024 * 1024;

interface ToolImageContextOptions {
  dataDir: string;
  vision?: 'supported' | 'unsupported';
  signal?: AbortSignal;
  readImage?: (dataDir: string, ref: ToolImageRef) => Promise<ProviderImage>;
}

/** Hydrate references only for this request; never replace or mutate persisted context. */
export async function prepareToolImageContext(
  messages: readonly ContextMessage[], options: ToolImageContextOptions,
): Promise<ContextMessage[]> {
  const selected = new Set<string>();
  let bytes = 0;
  if (options.vision === 'supported') {
    for (let index = messages.length - 1; index >= 0; index--) {
      const refs = messages[index].toolImages ?? [];
      for (let imageIndex = refs.length - 1; imageIndex >= 0; imageIndex--) {
        const ref = refs[imageIndex];
        if (selected.size >= MAX_MODEL_TOOL_IMAGES || bytes + ref.size > MAX_MODEL_TOOL_IMAGE_BYTES) continue;
        selected.add(`${index}:${imageIndex}`);
        bytes += ref.size;
      }
    }
  }
  const output: ContextMessage[] = [];
  for (const [index, message] of messages.entries()) {
    options.signal?.throwIfAborted();
    if (!message.toolImages?.length) { output.push(message); continue; }
    const images: ProviderImage[] = [];
    const notices = new Set<string>();
    for (const [imageIndex, ref] of message.toolImages.entries()) {
      if (!selected.has(`${index}:${imageIndex}`)) {
        notices.add(options.vision === 'supported'
          ? '较早的工具图片未随本次请求发送，历史图片引用仍保留。'
          : options.vision === 'unsupported'
            ? '当前模型不支持图片输入，工具图片未发送。'
            : '当前模型尚未确认图片输入能力，工具图片未发送。');
        continue;
      }
      try { images.push(await (options.readImage ?? readToolImage)(options.dataDir, ref)); }
      catch { notices.add(`工具图片无法读取：${ref.id}；不得假定已看到画面。`); }
    }
    const { images: _previousImages, ...stored } = message;
    output.push({ ...stored,
      content: appendNotices(message, [...notices]),
      ...(images.length ? { images } : {}),
    });
  }
  return output;
}

function appendNotices(message: ContextMessage, notices: string[]): string {
  if (!notices.length) return message.content;
  const parsed = message.role === 'user' ? parseTextToolResult(message.content) : undefined;
  const content = [parsed?.content ?? message.content, ...notices].filter(Boolean).join('\n');
  return parsed ? formatTextToolResult(parsed.name, content, parsed.ok) : content;
}
