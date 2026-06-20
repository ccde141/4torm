/**
 * 气旋工作室路径与底层 IO 助手
 *
 * 自写一份原子写/安全读，不 import 对流的 session.ts（零交叉代码铁律）。
 */

import fs from 'node:fs/promises';
import path from 'node:path';

/** 工作室根目录：data/cyclone/{workshopId}/ */
export function workshopDir(dataDir: string, id: string): string {
  return path.join(dataDir, 'cyclone', id);
}

/** 全部工作室索引文件：data/cyclone/_index.json */
export function workshopIndexFile(dataDir: string): string {
  return path.join(dataDir, 'cyclone', '_index.json');
}

/** 工作室元信息：data/cyclone/{id}/meta.json */
export function workshopMetaFile(dataDir: string, id: string): string {
  return path.join(workshopDir(dataDir, id), 'meta.json');
}

/** 共享工作区：data/cyclone/{id}/workspace/（所有工位 + 群聊共用） */
export function workshopWorkspace(dataDir: string, id: string): string {
  return path.join(workshopDir(dataDir, id), 'workspace');
}

/** 工位文件：data/cyclone/{id}/seats/{seatId}.json */
export function seatFile(dataDir: string, workshopId: string, seatId: string): string {
  return path.join(workshopDir(dataDir, workshopId), 'seats', `${seatId}.json`);
}

/** 工位目录：data/cyclone/{id}/seats/ */
export function seatsDir(dataDir: string, workshopId: string): string {
  return path.join(workshopDir(dataDir, workshopId), 'seats');
}

/** 群聊文件：data/cyclone/{id}/rooms/{roomId}.json */
export function roomFile(dataDir: string, workshopId: string, roomId: string): string {
  return path.join(workshopDir(dataDir, workshopId), 'rooms', `${roomId}.json`);
}

/** 群聊目录：data/cyclone/{id}/rooms/ */
export function roomsDir(dataDir: string, workshopId: string): string {
  return path.join(workshopDir(dataDir, workshopId), 'rooms');
}

// ── 底层 IO ──────────────────────────────────────────────────

/** 安全读 JSON：文件不存在或损坏返回 null，不抛 */
export async function readJsonSafe<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(file, 'utf-8')) as T; }
  catch { return null; }
}

/** 递归建目录 */
export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/** 原子写：先写 .tmp 再 rename 覆盖，防止半截 JSON */
export async function atomicWrite(filePath: string, data: string): Promise<void> {
  const tmp = filePath + '.tmp';
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, filePath);
}

/** 生成带前缀的随机 id（Date.now + 8 位随机，降低碰撞） */
export function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
