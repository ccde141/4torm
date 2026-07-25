import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { agentSessionsDir } from './data-paths.js';
import type { ProviderImage } from '../engine/shared/types.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/;
const IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
} as const;

export interface ConversationImageRef {
  id: string;
  name: string;
  mimeType: keyof typeof IMAGE_TYPES;
  size: number;
}

interface NewImage {
  name: string;
  mimeType: string;
  dataUrl: string;
}

function assertIdentifier(value: string): void {
  if (!IDENTIFIER.test(value)) throw new Error(`无效附件标识：${value}`);
}

function attachmentDir(dataDir: string, agentId: string, sessionId: string): string {
  assertIdentifier(agentId);
  assertIdentifier(sessionId);
  return path.join(agentSessionsDir(dataDir, agentId), `${sessionId}.attachments`);
}

function decodeImage(input: NewImage): { data: Buffer; mimeType: ConversationImageRef['mimeType'] } {
  if (!(input.mimeType in IMAGE_TYPES)) throw new Error(`不支持的图片类型：${input.mimeType}`);
  const prefix = `data:${input.mimeType};base64,`;
  if (!input.dataUrl.startsWith(prefix)) throw new Error('图片 data URL 与声明类型不一致');
  const encoded = input.dataUrl.slice(prefix.length);
  if (!encoded || !/^[a-zA-Z0-9+/]+={0,2}$/.test(encoded)) throw new Error('图片 data URL 无效');
  const data = Buffer.from(encoded, 'base64');
  if (data.length > MAX_IMAGE_BYTES) throw new Error('图片不能超过 8 MB');
  if (!hasImageSignature(input.mimeType, data)) throw new Error('图片内容与声明类型不一致');
  return { data, mimeType: input.mimeType as ConversationImageRef['mimeType'] };
}

function hasImageSignature(mimeType: string, data: Buffer): boolean {
  if (mimeType === 'image/png') return data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/jpeg') return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (mimeType === 'image/gif') return ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii'));
  return data.subarray(0, 4).toString('ascii') === 'RIFF'
    && data.subarray(8, 12).toString('ascii') === 'WEBP';
}

async function atomicWriteBuffer(filePath: string, data: Buffer): Promise<void> {
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, data, { flag: 'wx' });
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function saveConversationAttachment(
  dataDir: string,
  agentId: string,
  sessionId: string,
  input: NewImage,
): Promise<ConversationImageRef> {
  const { data, mimeType } = decodeImage(input);
  const id = randomUUID();
  const dir = attachmentDir(dataDir, agentId, sessionId);
  await fs.mkdir(dir, { recursive: true });
  await atomicWriteBuffer(path.join(dir, `${id}.${IMAGE_TYPES[mimeType]}`), data);
  return { id, name: path.basename(input.name) || 'image', mimeType, size: data.length };
}

export async function readConversationAttachment(
  dataDir: string,
  agentId: string,
  sessionId: string,
  attachmentId: string,
): Promise<{ data: Buffer; mimeType: ConversationImageRef['mimeType'] }> {
  assertIdentifier(attachmentId);
  const dir = attachmentDir(dataDir, agentId, sessionId);
  for (const [mimeType, extension] of Object.entries(IMAGE_TYPES)) {
    try {
      return {
        data: await fs.readFile(path.join(dir, `${attachmentId}.${extension}`)),
        mimeType: mimeType as ConversationImageRef['mimeType'],
      };
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`附件不存在：${attachmentId}`);
}

export async function resolveConversationImages(
  dataDir: string,
  agentId: string,
  sessionId: string,
  images: ConversationImageRef[],
): Promise<ProviderImage[]> {
  if (images.length > 4) throw new Error('单条消息最多包含 4 张图片');
  return Promise.all(images.map(async image => {
    if (!image || typeof image.name !== 'string' || typeof image.size !== 'number') {
      throw new Error('图片索引无效');
    }
    const stored = await readConversationAttachment(dataDir, agentId, sessionId, image.id);
    if (stored.mimeType !== image.mimeType) throw new Error(`附件类型不一致：${image.name}`);
    return {
      ...image,
      dataUrl: `data:${stored.mimeType};base64,${stored.data.toString('base64')}`,
    };
  }));
}

export async function deleteConversationAttachments(
  dataDir: string,
  agentId: string,
  sessionId: string,
): Promise<void> {
  await fs.rm(attachmentDir(dataDir, agentId, sessionId), { recursive: true, force: true });
}
