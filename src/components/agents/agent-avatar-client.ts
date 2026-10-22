import { backendFetch, backendUrl } from '../../lib/backend-client';
export const MAX_AVATAR_SOURCE_BYTES = 20 * 1024 * 1024;
const AVATAR_SIZE = 256;

export function validateAvatarFile(file: Pick<File, 'type' | 'size'>): string | undefined {
  if (file.size === 0) return '不能上传空图片';
  if (!file.type.startsWith('image/')) return '请选择图片文件';
  if (file.size > MAX_AVATAR_SOURCE_BYTES) return '原始图片不能超过 20 MB';
  return undefined;
}

export function avatarUrl(agentId: string, version: number): string {
  return backendUrl(`/api/agents/${encodeURIComponent(agentId)}/avatar?v=${version}`);
}

function canvasToWebp(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob || blob.type !== 'image/webp') {
        reject(new Error('当前环境无法生成 WebP 头像'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('头像编码失败'));
      reader.onload = () => typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('头像编码失败'));
      reader.readAsDataURL(blob);
    }, 'image/webp', 0.88);
  });
}

export async function normalizeAvatarFile(file: File): Promise<string> {
  const error = validateAvatarFile(file);
  if (error) throw new Error(error);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('图片已损坏或格式不受支持');
  }
  try {
    if (!bitmap.width || !bitmap.height) throw new Error('图片尺寸无效');
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法处理头像图片');
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    context.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    return await canvasToWebp(canvas);
  } finally {
    bitmap.close();
  }
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => ({}));
  return typeof body?.error === 'string' ? body.error : fallback;
}

export async function uploadAgentAvatar(agentId: string, dataUrl: string): Promise<number> {
  const response = await backendFetch(`/api/agents/${encodeURIComponent(agentId)}/avatar`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl }),
  });
  if (!response.ok) throw new Error(await errorMessage(response, '头像上传失败'));
  const body = await response.json() as { version: number };
  return body.version;
}

export async function removeAgentAvatar(agentId: string): Promise<void> {
  const response = await backendFetch(`/api/agents/${encodeURIComponent(agentId)}/avatar`, { method: 'DELETE' });
  if (!response.ok) throw new Error(await errorMessage(response, '头像移除失败'));
}
