import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWriteFile } from '../atomic-io.js';

const queues = new Map<string, Promise<unknown>>();
export function recallHash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function recallDirectory(dataDir: string, agentId: string): string {
  if (!/^[\p{L}\p{N}._-]{1,180}$/u.test(agentId) || agentId === '.' || agentId === '..') throw new Error('RECALL_OWNER_INVALID');
  return path.join(dataDir, 'agents', agentId, 'recall');
}
export async function readRecallJson<T>(file: string, valid: (value: unknown) => value is T): Promise<T | null> {
  let raw: string;
  try { raw = await fs.readFile(file, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('RECALL_STORE_CORRUPT'); }
  if (!valid(value)) throw new Error('RECALL_STORE_CORRUPT');
  return value;
}
export async function writeRecallJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await atomicWriteFile(file, JSON.stringify(value));
}
export async function withRecallLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
  queues.set(key, next);
  try { return await next; } finally { if (queues.get(key) === next) queues.delete(key); }
}
export function recallObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
