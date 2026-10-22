import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { McpToolOutcome } from './mcp-types.js';
import type { ProviderImage, ToolImageRef } from './types.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES = 4;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

/** Parse durable references only. Image bytes never belong in a context record. */
export function readToolImageRefs(value: unknown): ToolImageRef[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_IMAGES) throw new Error('工具图片引用数量无效');
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('工具图片引用无效');
    const ref = item as Record<string, unknown>;
    if (Object.keys(ref).some(key => !['id', 'name', 'mimeType', 'size'].includes(key))
      || typeof ref.id !== 'string' || !UUID.test(ref.id) || typeof ref.name !== 'string'
      || !ref.name || ref.name.length > 255 || /[\\/]/.test(ref.name) || ref.name.includes('\0')
      || typeof ref.mimeType !== 'string' || !Object.hasOwn(IMAGE_TYPES, ref.mimeType)
      || !Number.isSafeInteger(ref.size) || Number(ref.size) < 1 || Number(ref.size) > MAX_IMAGE_BYTES) {
      throw new Error('工具图片引用字段无效');
    }
    return { id: ref.id, name: ref.name, mimeType: ref.mimeType, size: Number(ref.size) };
  });
}

/** A tool is never replayed when publishing its returned image fails. */
export async function persistMcpToolOutcome(dataDir: string, outcome: McpToolOutcome): Promise<McpToolOutcome> {
  const { inlineImages, ...stored } = outcome;
  if (!inlineImages?.length) return stored;
  const toolImages = readToolImageRefs(stored.toolImages);
  const notices: string[] = [];
  for (let index = 0; index < inlineImages.length; index++) {
    if (toolImages.length >= MAX_IMAGES) {
      notices.push('MCP 返回的图片超过单次 4 张上限，其余图片未保存。');
      break;
    }
    try {
      const image = inlineImages[index];
      const data = decodeImage(image.mimeType, image.data);
      const directory = await mediaDirectory(dataDir, true);
      const id = randomUUID(), extension = IMAGE_TYPES[image.mimeType];
      const file = path.join(directory, `${id}.${extension}`);
      const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, data, { flag: 'wx' });
        await fs.rename(temporary, file);
      } catch (error) { await fs.rm(temporary, { force: true }).catch(() => {}); throw error; }
      toolImages.push({ id, name: `mcp-image-${index + 1}.${extension}`, mimeType: image.mimeType, size: data.length });
    } catch (error) {
      notices.push(`MCP 第 ${index + 1} 张图片未保存：${saveFailure(error)}。`);
    }
  }
  return { ...stored, result: [stored.result, ...notices].filter(Boolean).join('\n'),
    ...(toolImages.length ? { toolImages } : {}) };
}

export async function readToolImage(dataDir: string, ref: ToolImageRef): Promise<ProviderImage> {
  const image = readToolImageRefs([ref])[0];
  const directory = await mediaDirectory(dataDir, false);
  const file = path.join(directory, `${image.id}.${IMAGE_TYPES[image.mimeType]}`);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== image.size || stat.size > MAX_IMAGE_BYTES) {
    throw new Error('工具图片文件类型或大小无效');
  }
  const data = await fs.readFile(file);
  if (data.length !== image.size || !hasImageSignature(image.mimeType, data)) throw new Error('工具图片内容与引用不一致');
  return { id: image.id, name: image.name, mimeType: image.mimeType,
    dataUrl: `data:${image.mimeType};base64,${data.toString('base64')}` };
}

async function mediaDirectory(dataDir: string, create: boolean): Promise<string> {
  let current = path.resolve(dataDir);
  for (const segment of ['mcp', 'media']) {
    current = path.join(current, segment);
    if (create) await fs.mkdir(current, { recursive: false }).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    });
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('工具图片目录类型无效');
  }
  return current;
}

function decodeImage(mimeType: string, encoded: string): Buffer {
  if (!Object.hasOwn(IMAGE_TYPES, mimeType)) throw new Error('图片类型不受支持');
  if (typeof encoded !== 'string' || !encoded || encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4
    || encoded.length % 4 === 1 || !/^[a-zA-Z0-9+/]+={0,2}$/.test(encoded)) throw new Error('图片编码无效或超过 8 MiB');
  const data = Buffer.from(encoded, 'base64');
  if (data.length > MAX_IMAGE_BYTES) throw new Error('图片超过 8 MiB');
  if (!hasImageSignature(mimeType, data)) throw new Error('图片内容与声明类型不一致');
  return data;
}

function hasImageSignature(mimeType: string, data: Buffer): boolean {
  if (mimeType === 'image/png') return data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/jpeg') return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (mimeType === 'image/gif') return ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii'));
  return data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP';
}

function saveFailure(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOSPC') return '存储空间不足';
  if (code === 'EACCES' || code === 'EPERM') return '存储目录不可写';
  return error instanceof Error && !code ? error.message : '图片存储失败';
}
