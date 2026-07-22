/**
 * 气旋工作室路径与底层 IO 助手
 *
 * 自写一份原子写/安全读，不 import 对流的 session.ts（零交叉代码铁律）。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { readJsonFile } from '../../services/json-file-store.js';
import { atomicWriteFile } from '../shared/atomic-io.js';

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

/** 工作室公告板：data/cyclone/{id}/bulletin.json（工作室级，全体工位可见，人可编辑） */
export function workshopBulletinFile(dataDir: string, id: string): string {
  return path.join(workshopDir(dataDir, id), 'bulletin.json');
}

/** 公告板改动时间轴：data/cyclone/{id}/bulletin-history.json（审计 + 撤回；独立文件不拖慢 prompt 读） */
export function workshopBulletinHistoryFile(dataDir: string, id: string): string {
  return path.join(workshopDir(dataDir, id), 'bulletin-history.json');
}

/** 工位文件：data/cyclone/{id}/seats/{seatId}.json */
export function seatFile(dataDir: string, workshopId: string, seatId: string): string {
  return path.join(workshopDir(dataDir, workshopId), 'seats', `${seatId}.json`);
}

/** 工位目录：data/cyclone/{id}/seats/ */
export function seatsDir(dataDir: string, workshopId: string): string {
  return path.join(workshopDir(dataDir, workshopId), 'seats');
}

/** 工位任务板：data/cyclone/{id}/seats/{seatId}.taskboard.json（与工位数据同目录） */
export function seatTaskboardFile(dataDir: string, workshopId: string, seatId: string): string {
  return path.join(workshopDir(dataDir, workshopId), 'seats', `${seatId}.taskboard.json`);
}

/** 群聊文件：data/cyclone/{id}/rooms/{roomId}.json */
export function roomFile(dataDir: string, workshopId: string, roomId: string): string {
  return path.join(workshopDir(dataDir, workshopId), 'rooms', `${roomId}.json`);
}

/** 群聊目录：data/cyclone/{id}/rooms/ */
export function roomsDir(dataDir: string, workshopId: string): string {
  return path.join(workshopDir(dataDir, workshopId), 'rooms');
}

/** 异步派发目录：data/cyclone/{id}/dispatches/ */
export function dispatchesDir(dataDir: string, workshopId: string): string {
  return path.join(workshopDir(dataDir, workshopId), 'dispatches');
}

/** 单条异步派发记录：data/cyclone/{id}/dispatches/{dispatchId}.json */
export function dispatchFile(dataDir: string, workshopId: string, dispatchId: string): string {
  return path.join(dispatchesDir(dataDir, workshopId), `${dispatchId}.json`);
}

/** 归档目录：data/cyclone/{id}/bak/ */
export function workshopBakDir(dataDir: string, workshopId: string): string {
  return path.join(workshopDir(dataDir, workshopId), 'bak');
}

/** 归档文件：data/cyclone/{id}/bak/{name} */
export function cycloneArchiveFile(dataDir: string, workshopId: string, name: string): string {
  return path.join(workshopBakDir(dataDir, workshopId), name);
}

// ── 底层 IO ──────────────────────────────────────────────────

/**
 * 安全读 JSON。区分三种情形，绝不把"坏了"悄悄当成"没有"：
 * - 文件不存在（ENOENT）→ 返回 null（正常：未创建 / 已删除）
 * - 文件存在但 JSON 损坏 → 隔离改名为 .corrupt-* + 告警，再返回 null（原文件保留可恢复，不静默蒸发）
 * - 其它读失败（权限 / IO）→ 抛出（异常情形，要出声，别假装空）
 * 顺带容忍 UTF-8 BOM —— 当初正是开头的 BOM 让 JSON.parse 抛错、房间凭空消失。
 */
export async function readJsonSafe<T>(file: string): Promise<T | null> {
  return readJsonFile<T>(file, 'cyclone');
}

/**
 * 删除文件/目录。不存在视作"删除目标已达成"（幂等，静默）；
 * 其它失败（权限 / 占用）抛出，绝不静默吞掉 —— 否则用户以为删了，实体下次诈尸。
 */
export async function removeStrict(targetPath: string, opts?: { recursive?: boolean }): Promise<void> {
  try {
    await fs.rm(targetPath, { recursive: opts?.recursive ?? false, force: false });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw e;
  }
}

/** 递归建目录 */
export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/** 原子写：先写 .tmp 再 rename 覆盖，防止半截 JSON */
export async function atomicWrite(filePath: string, data: string): Promise<void> {
  await atomicWriteFile(filePath, data);
}

/** 生成带前缀的随机 id（Date.now + 8 位随机，降低碰撞） */
export function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
