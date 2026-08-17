import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { agentAvatarFile, agentRegistryFile } from './data-paths.js';

const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/;
const PREFIX = 'data:image/webp;base64,';
const MAX_AVATAR_BYTES = 1024 * 1024;

function assertAgentId(agentId: string): void {
  if (!IDENTIFIER.test(agentId)) throw new Error('无效 Agent 标识');
}

async function assertAgentExists(dataDir: string, agentId: string): Promise<void> {
  const raw = await fs.readFile(agentRegistryFile(dataDir), 'utf8').catch(() => '{}');
  const registry = JSON.parse(raw) as Record<string, unknown>;
  if (!registry[agentId]) throw new Error('Agent 不存在');
}

function decodeWebp(dataUrl: string): Buffer {
  if (!dataUrl.startsWith(PREFIX)) throw new Error('头像必须是规范化 WebP');
  const encoded = dataUrl.slice(PREFIX.length);
  if (!encoded || !/^[a-zA-Z0-9+/]+={0,2}$/.test(encoded)) throw new Error('头像数据无效');
  const data = Buffer.from(encoded, 'base64');
  if (data.length === 0 || data.length > MAX_AVATAR_BYTES) throw new Error('头像不能超过 1 MB');
  const isWebp = data.subarray(0, 4).toString('ascii') === 'RIFF'
    && data.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!isWebp) throw new Error('头像内容不是有效 WebP');
  return data;
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

export async function saveAgentAvatar(
  dataDir: string,
  agentId: string,
  dataUrl: string,
): Promise<{ version: number }> {
  assertAgentId(agentId);
  await assertAgentExists(dataDir, agentId);
  const data = decodeWebp(dataUrl);
  const target = agentAvatarFile(dataDir, agentId);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await atomicWriteBuffer(target, data);
  return { version: Date.now() };
}

export async function readAgentAvatar(dataDir: string, agentId: string): Promise<Buffer> {
  assertAgentId(agentId);
  return fs.readFile(agentAvatarFile(dataDir, agentId));
}

export async function deleteAgentAvatar(dataDir: string, agentId: string): Promise<void> {
  assertAgentId(agentId);
  await fs.rm(agentAvatarFile(dataDir, agentId), { force: true });
}
