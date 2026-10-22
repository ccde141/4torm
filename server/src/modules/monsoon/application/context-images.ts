import type { ContextMessage } from '../../../engine/shared/types.js';
import { readToolImageRefs } from '../../../engine/shared/tool-media-store.js';
import { resolveConversationImages, type ConversationImageRef } from '../infrastructure/attachments.js';
import type { MonsoonMessage } from '../domain/session.js';

export type StoredMonsoonContextMessage = Omit<ContextMessage, 'images'> & {
  images?: ConversationImageRef[];
};
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** A persisted exact context contains attachment references, never another copy of image bytes. */
export function persistMonsoonContext(
  messages: readonly ContextMessage[] | readonly StoredMonsoonContextMessage[],
): StoredMonsoonContextMessage[] {
  return messages.map(message => {
    const { images, toolImages, ...rest } = structuredClone(message);
    return { ...rest, ...(images ? { images: images.map(imageReference) } : {}),
      ...(toolImages !== undefined ? { toolImages: readToolImageRefs(toolImages) } : {}) };
  });
}

export function readStoredMonsoonContext(value: unknown): StoredMonsoonContextMessage[] {
  if (!Array.isArray(value)) throw new Error('会话精确上下文无效');
  const messages = value.map(item => {
    if (!record(item) || !['system', 'user', 'assistant', 'tool'].includes(String(item.role))
      || typeof item.content !== 'string') throw new Error('会话精确上下文消息无效');
    if (item.images !== undefined && !Array.isArray(item.images)) throw new Error('会话图片索引无效');
    return { ...structuredClone(item), ...(Array.isArray(item.images)
      ? { images: item.images.map(imageReference) } : {}) } as StoredMonsoonContextMessage;
  });
  return persistMonsoonContext(messages);
}

export function persistMonsoonMessageImages(message: MonsoonMessage): MonsoonMessage {
  return { ...structuredClone(message),
    ...(Array.isArray(message.images) ? { images: message.images.map(imageReference) } : {}),
    ...(Array.isArray(message.nativeContext)
      ? { nativeContext: readStoredMonsoonContext(message.nativeContext) } : {}) };
}

/** Synchronous projections are safe for summaries; model requests use the hydrated projection. */
export function textMonsoonContext(messages: readonly StoredMonsoonContextMessage[]): ContextMessage[] {
  return messages.map(message => {
    const { images, ...rest } = structuredClone(message);
    const refs = images?.map(image => `[附件引用：${image.name}；ID=${image.id}]`).join('\n');
    return { ...rest, content: refs ? append(message.content, refs) : message.content };
  });
}

export async function hydrateMonsoonContext(
  dataDir: string, agentId: string, sessionId: string,
  messages: readonly StoredMonsoonContextMessage[],
): Promise<ContextMessage[]> {
  return Promise.all(messages.map(async message => {
    const { images, ...rest } = structuredClone(message);
    if (!images?.length) return rest;
    const resolved = await resolveConversationImages(dataDir, agentId, sessionId, images);
    const missing = resolved.missing.map(image => `[附件不存在：${image.name}]`).join('\n');
    return { ...rest, content: missing ? append(message.content, missing) : message.content,
      ...(resolved.images.length ? { images: resolved.images } : {}) };
  }));
}

function imageReference(value: unknown): ConversationImageRef {
  if (!record(value) || typeof value.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(value.id)
    || typeof value.name !== 'string' || typeof value.mimeType !== 'string'
    || !IMAGE_TYPES.has(value.mimeType)) throw new Error('会话图片索引无效');
  const size = imageSize(value);
  return { id: value.id, name: value.name, mimeType: value.mimeType as ConversationImageRef['mimeType'], size };
}

function imageSize(value: Record<string, unknown>): number {
  if (typeof value.size === 'number' && Number.isSafeInteger(value.size) && value.size >= 0) return value.size;
  const prefix = `data:${value.mimeType};base64,`;
  if (typeof value.dataUrl === 'string' && value.dataUrl.startsWith(prefix)) {
    return Buffer.byteLength(value.dataUrl.slice(prefix.length), 'base64');
  }
  throw new Error('会话图片索引缺少有效大小');
}

function append(content: string, notice: string): string {
  return content.includes(notice) ? content : content ? `${content}\n\n${notice}` : notice;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
