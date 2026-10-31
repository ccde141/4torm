import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { frameworkError } from './framework-error.js';

const MAX_PREVIEW_BYTES = 1024 * 1024;
const CACHE_BYTES = 16 * 1024 * 1024;
const CACHE_ENTRIES = 128;
const CONCURRENCY = 2;
const MAX_PENDING = 18;
const cache = new Map<string, Buffer>();
const pending = new Map<string, Promise<Buffer>>();
const waiting: Array<() => void> = [];
let cacheBytes = 0;
let active = 0;

// Decoding is shared by preview requests only; model inputs keep their original bytes.
sharp.cache({ memory: 16, files: 0, items: 64 });
sharp.concurrency(1);

/** Call after the owning feature has authorized access to the original image. */
export async function toolImagePreview(data: Buffer): Promise<Buffer> {
  const key = createHash('sha256').update(data).digest('hex');
  const cached = cache.get(key);
  if (cached) { cache.delete(key); cache.set(key, cached); return cached; }
  const running = pending.get(key);
  if (running) return running;
  if (pending.size >= MAX_PENDING) throw frameworkError({ code: 'TOOL_IMAGE_PREVIEW_BUSY',
    kind: 'conflict', message: '图片预览正在处理，请稍后重试', source: 'tool-media', retryable: true });
  const work = renderPreview(data).then(result => {
    cache.set(key, result); cacheBytes += result.length;
    while (cache.size > CACHE_ENTRIES || cacheBytes > CACHE_BYTES) {
      const oldest = cache.keys().next().value!;
      cacheBytes -= cache.get(oldest)!.length; cache.delete(oldest);
    }
    return result;
  }).finally(() => { pending.delete(key); });
  pending.set(key, work);
  return work;
}

async function renderPreview(data: Buffer): Promise<Buffer> {
  if (active < CONCURRENCY) active++;
  else await new Promise<void>(resolve => waiting.push(resolve));
  try {
    const result = await sharp(data, { limitInputPixels: 40_000_000, pages: 1, sequentialRead: true })
      .rotate().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75, effort: 2 }).timeout({ seconds: 10 }).toBuffer();
    if (result.length > MAX_PREVIEW_BYTES) throw new Error('Preview exceeds its output allowance');
    return result;
  } catch {
    throw frameworkError({ code: 'TOOL_IMAGE_PREVIEW_UNAVAILABLE', kind: 'validation',
      message: '这张图片无法生成预览，可查看原图', source: 'tool-media', retryable: false });
  } finally {
    const next = waiting.shift();
    if (next) next(); else active--;
  }
}
