import { isProviderContextOverflow } from '../provider-request-error.js';

type Body = Record<string, unknown>;
interface Part { [key: string]: unknown; type?: string }
interface ImageSlot { parts: Part[]; index: number }
const MAX_RETRIES = 4;
const RETENTION_MS = 5 * 60 * 1000;
const learned = new Map<string, { count: number; expires: number }>();

/** Inspect content blocks only; never rewrite tools, tool inputs, or image archives. */
function imageSlots(body: Body): ImageSlot[] {
  const images: ImageSlot[] = [];
  const visit = (parts: unknown) => {
    if (!Array.isArray(parts)) return;
    parts.forEach((part: Part, index) => {
      if (!part || typeof part !== 'object') return;
      if (part.type === 'image' || part.type === 'image_url') images.push({ parts, index });
      else if (part.type === 'tool_result') visit(part.content);
    });
  };
  if (Array.isArray(body.messages)) body.messages.forEach(message => visit(message?.content));
  return images;
}

export function retainNewestRequestImages(body: Body, keep: number): Body {
  const copy = structuredClone(body);
  const images = imageSlots(copy);
  for (const slot of images.slice(0, Math.max(0, images.length - Math.max(1, keep)))) {
    slot.parts[slot.index] = { type: 'text', text: '（较早的图片未随本次请求发送，原始图片记录仍保留。）' };
  }
  return copy;
}

export function applyLearnedImageLimit(key: string, body: Body): Body {
  const hint = learned.get(key);
  return hint && hint.expires > Date.now() ? retainNewestRequestImages(body, hint.count) : body;
}

function imageRejection(error: unknown): { countLimit: boolean; limit?: number } | undefined {
  if (!error || typeof error !== 'object') return;
  const data = (error as { data?: { code?: string } }).data;
  if (isProviderContextOverflow(error) || data?.code === 'MODEL_PROVIDER_HTTP_413') return { countLimit: false };
  if (data?.code !== 'MODEL_IMAGE_LIMIT_EXCEEDED') return;
  const message = error instanceof Error ? error.message : '';
  const limit = /(?:at most|no more than|maximum(?: of)?|max|limit)[^\d]{0,20}(\d{1,3})\s*(?:images|image inputs|张|幅)|(?:maximum|max) (?:number|count) of images\s*(?:is|:|=)?\s*(\d{1,3})|(?:image|images)\s*(?:count|number)?\s*(?:limit|maximum|max)\s*(?:is|:|=)?\s*(\d{1,3})|(?:图片|图像).{0,15}(?:最多|上限|不超过|至多)[^\d]{0,8}(\d{1,3})/i.exec(message);
  const countLimit = /too many|(?:number|count).{0,20}(?:image|limit|exceed)|(?:image|images).{0,20}(?:number|count)|\d+\s*(?:images|image inputs)|(?:图片|图像).{0,25}(?:数量|张|过多)/i.test(message);
  return { countLimit, ...(limit ? { limit: Number(limit.slice(1).find(value => value !== undefined)) } : {}) };
}

/** Retry only explicit input rejections before output; each attempt gets its own usage record. */
export async function withImageLimitRecovery<T>(options: {
  key: string; body: Body; signal?: AbortSignal; canRetry(): boolean; send(body: Body): Promise<T>;
}): Promise<T> {
  let body = applyLearnedImageLimit(options.key, options.body);
  let learnCount = false;
  for (let attempt = 0; ; attempt++) {
    options.signal?.throwIfAborted();
    try {
      const result = await options.send(body);
      if (learnCount) {
        for (const [key, value] of learned) if (value.expires <= Date.now()) learned.delete(key);
        learned.delete(options.key);
        learned.set(options.key, { count: imageSlots(body).length, expires: Date.now() + RETENTION_MS });
        while (learned.size > 128) learned.delete(learned.keys().next().value!);
      }
      return result;
    } catch (error) {
      const rejection = imageRejection(error);
      const count = imageSlots(body).length;
      if (!rejection || !options.canRetry() || options.signal?.aborted || count <= 1 || attempt >= MAX_RETRIES) throw error;
      const fallback = rejection.countLimit && count <= MAX_RETRIES + 1 ? count - 1 : Math.max(1, Math.floor(count / 2));
      const keep = rejection.limit && rejection.limit < count && rejection.limit >= 1
        ? rejection.limit : attempt === MAX_RETRIES - 1 ? 1 : fallback;
      body = retainNewestRequestImages(body, keep);
      learnCount ||= rejection.countLimit;
    }
  }
}
