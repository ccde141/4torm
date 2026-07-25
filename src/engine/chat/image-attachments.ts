import type { ImageAttachment } from '../../types';

export const MAX_MESSAGE_IMAGES = 4;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
const SUPPORTED = new Set(IMAGE_ACCEPT.split(','));

export interface ImageDraft {
  key: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
}

export function validateImageSelection(
  file: Pick<File, 'type' | 'size'>,
  currentCount: number,
): string | undefined {
  if (currentCount >= MAX_MESSAGE_IMAGES) return `单条消息最多添加 ${MAX_MESSAGE_IMAGES} 张图片`;
  if (!SUPPORTED.has(file.type)) return '仅支持 PNG、JPEG、WebP 和 GIF 图片';
  if (file.size > MAX_IMAGE_BYTES) return '单张图片不能超过 8 MB';
  if (file.size === 0) return '不能添加空图片';
  return undefined;
}

export async function createImageDraft(file: File, currentCount: number): Promise<ImageDraft> {
  const error = validateImageSelection(file, currentCount);
  if (error) throw new Error(error);
  const dataUrl = await readAsDataUrl(file);
  return {
    key: crypto.randomUUID(), name: file.name || 'image',
    mimeType: file.type, size: file.size, dataUrl,
  };
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`无法读取图片：${file.name}`));
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error(`无法读取图片：${file.name}`));
    reader.readAsDataURL(file);
  });
}

export async function uploadImageDraft(
  agentId: string,
  sessionId: string,
  draft: ImageDraft,
): Promise<ImageAttachment> {
  const response = await fetch('/api/conversation/attachments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId, sessionId, name: draft.name,
      mimeType: draft.mimeType, dataUrl: draft.dataUrl,
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error || `图片上传失败（HTTP ${response.status}）`);
  }
  return response.json();
}

export function attachmentUrl(agentId: string, sessionId: string, attachmentId: string): string {
  return `/api/conversation/attachments/${encodeURIComponent(agentId)}/${encodeURIComponent(sessionId)}/${encodeURIComponent(attachmentId)}`;
}

export async function deleteConversationImages(agentId: string, sessionId: string): Promise<void> {
  const response = await fetch(
    `/api/conversation/attachments/${encodeURIComponent(agentId)}/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' },
  );
  if (!response.ok) throw new Error(`会话附件清理失败（HTTP ${response.status}）`);
}
